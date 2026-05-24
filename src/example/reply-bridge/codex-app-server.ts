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

interface CodexRequestStep {
  request: Record<string, unknown>;
  delayAfterMs?: number;
}

function isCodexRequestStep(
  step: Record<string, unknown> | CodexRequestStep,
): step is CodexRequestStep {
  return "request" in step;
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

    const initializedId = nextId;
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializedId,
        method: "initialize",
        params: {
          clientInfo: this.clientInfo,
          protocolVersion: "2",
          capabilities: {},
        },
      })}\n`,
    );
    nextId += 1;
    await waitForResult(initializedId, 15000);

    const collected: T[] = [];
    for (const step of requests) {
      const request = isCodexRequestStep(step) ? step.request : step;
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

    child.kill();
    await closePromise;

    return collected;
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

  async startTurn(threadId: string, text: string): Promise<void> {
    await this.sendRequests<unknown>([
      {
        request: {
          method: "thread/resume",
          params: {
            threadId,
          },
        },
        delayAfterMs: 800,
      },
      {
        method: "turn/start",
        params: {
          threadId,
          input: [
            {
              type: "text",
              text,
            },
          ],
        },
      },
    ]);
  }
}
