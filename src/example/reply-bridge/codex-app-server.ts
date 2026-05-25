import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface CodexAppServerClientInfo {
  name: string;
  version: string;
}

export interface CodexThreadReadResult {
  thread?: {
    id?: string;
    cwd?: string;
    path?: string;
  };
}

export interface CodexTurnStartResult {
  turn?: {
    id?: string;
    status?: {
      type?: string;
    };
  };
}

export interface CodexThreadStartResult {
  thread?: {
    id?: string;
    cwd?: string;
    path?: string;
  };
}

export interface StartProjectThreadOptions {
  cwd: string;
  text: string;
  title?: string;
}

export interface StartTurnOptions {
  cwd?: string;
  title?: string;
  skipResume?: boolean;
}

const AUTOMATION_APPROVAL_POLICY = "never";
const AUTOMATION_SANDBOX_MODE = "danger-full-access";
const AUTOMATION_SANDBOX_POLICY = {
  type: "dangerFullAccess",
};

interface CodexRequestStep {
  request: Record<string, unknown> | ((results: unknown[]) => Record<string, unknown>);
  delayAfterMs?: number;
}

interface SendRequestsOptions<T> {
  waitForNotification?: (message: unknown, results: T[]) => boolean;
  completionTimeoutMs?: number;
}

function isCodexRequestStep(
  step: Record<string, unknown> | CodexRequestStep,
): step is CodexRequestStep {
  return "request" in step;
}

function resolveRequestPayload(
  step: Record<string, unknown> | CodexRequestStep,
  results: unknown[],
): Record<string, unknown> {
  if (!isCodexRequestStep(step)) {
    return step;
  }

  return typeof step.request === "function"
    ? step.request(results)
    : step.request;
}

function getNotificationMethod(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const method = (message as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}

function getNotificationThreadId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const params = (message as { params?: { threadId?: unknown } }).params;
  return typeof params?.threadId === "string" ? params.threadId : undefined;
}

function getNotificationTurnId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const params = (
    message as {
      params?: {
        turnId?: unknown;
        turn?: { id?: unknown };
      };
    }
  ).params;

  if (typeof params?.turnId === "string") {
    return params.turnId;
  }

  return typeof params?.turn?.id === "string" ? params.turn.id : undefined;
}

function normalizeStatusType(value: string | undefined): string | undefined {
  return value?.toLowerCase().replace(/[^a-z]/g, "");
}

function getThreadStatusType(message: unknown): string | undefined {
  if (getNotificationMethod(message) !== "thread/status/changed") {
    return undefined;
  }

  const status = (
    message as {
      params?: {
        status?: { type?: unknown };
      };
    }
  ).params?.status?.type;

  return typeof status === "string" ? status : undefined;
}

export interface ResolveCodexCliPathOptions {
  explicitPath?: string;
  platform?: NodeJS.Platform;
  localAppData?: string;
  pathExists?: (path: string) => boolean;
  readDirNames?: (path: string) => string[];
}

export function resolveCodexCliPath(
  options: ResolveCodexCliPathOptions = {},
): string {
  const explicitPath = options.explicitPath || process.env.CODEX_CLI_PATH;
  if (explicitPath) {
    return explicitPath;
  }

  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return "codex";
  }

  const localAppData = options.localAppData || process.env.LOCALAPPDATA;
  const pathExists = options.pathExists || existsSync;
  const readDirNames =
    options.readDirNames ||
    ((path: string) =>
      readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name));

  if (!localAppData) {
    return "codex";
  }

  const codexBinDir = join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const versionedExePaths = readDirNames(codexBinDir)
      .map((dirname) => join(codexBinDir, dirname, "codex.exe"))
      .filter(pathExists)
      .sort()
      .reverse();

    if (versionedExePaths.length > 0) {
      return versionedExePaths[0];
    }
  } catch {
    // Fall through to the top-level launcher path below.
  }

  const directExe = join(codexBinDir, "codex.exe");
  if (pathExists(directExe)) {
    return directExe;
  }

  return "codex";
}

export class CodexAppServerClient {
  private readonly codexPath: string;
  private readonly clientInfo: CodexAppServerClientInfo;

  constructor(
    codexPath = resolveCodexCliPath(),
    clientInfo: CodexAppServerClientInfo = {
      name: "weixin-reply-bridge",
      version: "1.0.0",
    },
  ) {
    this.codexPath = codexPath;
    this.clientInfo = clientInfo;
  }

  private async sendRequests<T = unknown>(
    requests: Array<Record<string, unknown> | CodexRequestStep>,
    options: SendRequestsOptions<T> = {},
  ): Promise<T[]> {
    const child = spawn(
      this.codexPath,
      ["app-server", "--listen", "stdio://"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    const results = new Map<number, unknown>();
    const parsedMessages: unknown[] = [];
    let nextId = 1;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        parsedMessages.push(parsed);

        if (
          parsed &&
          typeof parsed === "object" &&
          "id" in parsed &&
          "result" in parsed &&
          typeof (parsed as { id?: unknown }).id === "number"
        ) {
          const response = parsed as { id: number; result: unknown };
          results.set(response.id, response.result);
        }

        if (
          parsed &&
          typeof parsed === "object" &&
          "id" in parsed &&
          "error" in parsed &&
          typeof (parsed as { id?: unknown }).id === "number"
        ) {
          const response = parsed as { id: number; error: { message?: string } };
          results.set(response.id, new Error(response.error?.message || "Unknown app-server error"));
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });
    const waitForResult = (id: number, timeoutMs: number): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const startedAt = Date.now();

        const timer = setInterval(() => {
          if (results.has(id)) {
            clearInterval(timer);
            const result = results.get(id);
            results.delete(id);
            resolve(result);
            return;
          }

          if (settled) {
            clearInterval(timer);
            reject(
              new Error(
                `Missing app-server response for request ${id}.${stderrBuffer ? ` stderr=${stderrBuffer}` : ""}`,
              ),
            );
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            child.kill();
            reject(new Error("Timed out waiting for Codex app-server response."));
          }
        }, 20);
      });

    const closePromise = new Promise<void>((resolve, reject) => {
      child.on("error", (error) => {
        settled = true;
        reject(error);
      });

      child.on("close", () => {
        settled = true;
        resolve();
      });
    });

    const waitForNotification = (timeoutMs: number): Promise<void> =>
      new Promise((resolve, reject) => {
        let checkedCount = 0;
        const startedAt = Date.now();

        const timer = setInterval(() => {
          for (; checkedCount < parsedMessages.length; checkedCount += 1) {
            if (options.waitForNotification?.(parsedMessages[checkedCount], collected)) {
              clearInterval(timer);
              resolve();
              return;
            }
          }

          if (settled) {
            clearInterval(timer);
            reject(
              new Error(
                `Codex app-server closed before the turn completed.${stderrBuffer ? ` stderr=${stderrBuffer}` : ""}`,
              ),
            );
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            child.kill();
            reject(new Error("Timed out waiting for Codex turn completion notification."));
          }
        }, 20);
      });

    const collected: T[] = [];

    try {
      const initializedId = nextId;
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: initializedId,
          method: "initialize",
          params: {
            clientInfo: this.clientInfo,
            capabilities: {
              experimentalApi: true,
              requestAttestation: false,
            },
          },
        })}\n`,
      );
      nextId += 1;
      await waitForResult(initializedId, 15000);
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "initialized",
        })}\n`,
      );

      for (const step of requests) {
        const request = resolveRequestPayload(step, collected);
        const id = nextId;
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id,
            ...request,
          })}\n`,
        );
        nextId += 1;

        const result = await waitForResult(id, 15000);
        if (result instanceof Error) {
          throw result;
        }
        collected.push(result as T);

        if (isCodexRequestStep(step) && step.delayAfterMs) {
          await new Promise((resolve) => setTimeout(resolve, step.delayAfterMs));
        }
      }

      if (options.waitForNotification) {
        await waitForNotification(options.completionTimeoutMs ?? 120000);
      }

      return collected;
    } finally {
      child.kill();
      await closePromise;
    }
  }

  async readThread(threadId: string): Promise<CodexThreadReadResult> {
    const [result] = await this.sendRequests<CodexThreadReadResult>([
      {
        method: "thread/read",
        params: {
          threadId,
          includeTurns: false,
        },
      },
    ]);

    return result;
  }

  async waitUntilThreadIdle(threadId: string): Promise<void> {
    await this.sendRequests<unknown>(
      [
        {
          method: "thread/resume",
          params: {
            threadId,
          },
        },
      ],
      {
        waitForNotification: (message) => {
          const messageThreadId = getNotificationThreadId(message);
          const threadStatusType = normalizeStatusType(getThreadStatusType(message));
          return messageThreadId === threadId && threadStatusType === "idle";
        },
        completionTimeoutMs: 300000,
      },
    );
  }

  async startTurn(threadId: string, text: string, options: StartTurnOptions = {}): Promise<void> {
    let sawTurnActivity = false;
    const requests: Array<Record<string, unknown> | CodexRequestStep> = [];

    if (!options.skipResume) {
      requests.push({
        request: {
          method: "thread/resume",
          params: {
            threadId,
            cwd: options.cwd,
            approvalPolicy: AUTOMATION_APPROVAL_POLICY,
            sandbox: AUTOMATION_SANDBOX_MODE,
          },
        },
        delayAfterMs: 800,
      });
    }

    requests.push({
      method: "turn/start",
      params: {
        threadId,
        input: [
          {
            type: "text",
            text,
          },
        ],
        cwd: options.cwd,
        approvalPolicy: AUTOMATION_APPROVAL_POLICY,
        sandboxPolicy: AUTOMATION_SANDBOX_POLICY,
        title: options.title,
      },
    });

    const results = await this.sendRequests<unknown>(
      requests,
      {
        waitForNotification: (message, results) => {
          const startResult = results[results.length - 1] as CodexTurnStartResult | undefined;
          const startedTurnId = startResult?.turn?.id;
          if (!startedTurnId) {
            return false;
          }

          const method = getNotificationMethod(message);
          const messageThreadId = getNotificationThreadId(message);
          const messageTurnId = getNotificationTurnId(message);

          if (
            method === "turn/started" &&
            messageThreadId === threadId &&
            messageTurnId === startedTurnId
          ) {
            sawTurnActivity = true;
            return false;
          }

          if (
            method === "turn/completed" &&
            messageThreadId === threadId &&
            messageTurnId === startedTurnId
          ) {
            return true;
          }

          const threadStatusType = normalizeStatusType(getThreadStatusType(message));
          if (messageThreadId === threadId && threadStatusType === "inprogress") {
            sawTurnActivity = true;
            return false;
          }

          return messageThreadId === threadId && sawTurnActivity && threadStatusType === "idle";
        },
      },
    );

    const turnStartResult = results[results.length - 1];
    const startedTurnId = (turnStartResult as CodexTurnStartResult | undefined)?.turn?.id;
    if (!startedTurnId) {
      throw new Error("Codex app-server did not return a turn id for turn/start.");
    }
  }

  async startProjectThread(
    options: StartProjectThreadOptions,
  ): Promise<{ threadId: string; path?: string }> {
    let capturedThreadId: string | undefined;
    let capturedThreadPath: string | undefined;
    let sawTurnActivity = false;

    const [, turnStartResult] = await this.sendRequests<unknown>(
      [
        {
          request: {
            method: "thread/start",
            params: {
              cwd: options.cwd,
              approvalPolicy: AUTOMATION_APPROVAL_POLICY,
              sandbox: AUTOMATION_SANDBOX_MODE,
            },
          },
          delayAfterMs: 100,
        },
        {
          request: (results) => {
            const threadStart = results[0] as CodexThreadStartResult | undefined;
            const threadId = threadStart?.thread?.id;
            if (!threadId) {
              throw new Error("Codex app-server did not return a thread id for thread/start.");
            }

            return {
              method: "turn/start",
              params: {
                threadId,
                input: [
                  {
                    type: "text",
                    text: options.text,
                  },
                ],
                cwd: options.cwd,
                approvalPolicy: AUTOMATION_APPROVAL_POLICY,
                sandboxPolicy: AUTOMATION_SANDBOX_POLICY,
                title: options.title,
              },
            };
          },
        },
      ],
      {
        waitForNotification: (message, results) => {
          const threadStart = results[0] as CodexThreadStartResult | undefined;
          const threadId = threadStart?.thread?.id;
          if (threadId && !capturedThreadId) {
            capturedThreadId = threadId;
            capturedThreadPath = threadStart?.thread?.path;
          }

          const startResult = results[1] as CodexTurnStartResult | undefined;
          const startedTurnId = startResult?.turn?.id;
          if (!threadId || !startedTurnId) {
            return false;
          }

          const method = getNotificationMethod(message);
          const messageThreadId = getNotificationThreadId(message);
          const messageTurnId = getNotificationTurnId(message);

          if (
            method === "turn/started" &&
            messageThreadId === threadId &&
            messageTurnId === startedTurnId
          ) {
            sawTurnActivity = true;
            return false;
          }

          if (
            method === "turn/completed" &&
            messageThreadId === threadId &&
            messageTurnId === startedTurnId
          ) {
            return true;
          }

          const threadStatusType = normalizeStatusType(getThreadStatusType(message));
          if (messageThreadId === threadId && threadStatusType === "inprogress") {
            sawTurnActivity = true;
            return false;
          }

          return messageThreadId === threadId && sawTurnActivity && threadStatusType === "idle";
        },
      },
    );

    const threadId = capturedThreadId;
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id for thread/start.");
    }

    const startedTurnId = (turnStartResult as CodexTurnStartResult | undefined)?.turn?.id;
    if (!startedTurnId) {
      throw new Error("Codex app-server did not return a turn id for turn/start.");
    }

    return {
      threadId,
      path: capturedThreadPath,
    };
  }
}
