import test from "node:test";
import assert from "node:assert/strict";
import { parseReplyBridgeArgs } from "../src/example/reply-bridge/cli.js";
import { parseCodexSendArgs } from "../src/example/reply-bridge/codex-send.js";
import { parseManualInjectArgs } from "../src/example/reply-bridge/manual-inject.js";
import { parseProjectThreadStartArgs } from "../src/example/reply-bridge/project-thread-start.js";
import { parseSdkListenArgs } from "../src/example/reply-bridge/sdk-listen.js";
import { parseSimpleTurnStartArgs } from "../src/example/reply-bridge/simple-turn-start.js";
import { CodexAppServerClient, resolveCodexCliPath } from "../src/example/reply-bridge/codex-app-server.js";

test("parseReplyBridgeArgs extracts thread and timing options", () => {
  const options = parseReplyBridgeArgs([
    "--thread",
    "thread-1",
    "--to",
    "user-1",
    "--alive-seconds",
    "120",
    "--poll-ms",
    "3000",
  ]);

  assert.equal(options.threadId, "thread-1");
  assert.equal(options.to, "user-1");
  assert.equal(options.aliveSeconds, 120);
  assert.equal(options.pollIntervalMs, 3000);
});

test("parseReplyBridgeArgs keeps defaults", () => {
  const options = parseReplyBridgeArgs(["--thread", "thread-2"]);
  assert.equal(options.threadId, "thread-2");
  assert.equal(options.aliveSeconds, 300);
  assert.equal(options.pollIntervalMs, 5000);
});

test("parseManualInjectArgs extracts wait-idle options", () => {
  const options = parseManualInjectArgs([
    "--thread",
    "thread-3",
    "--text",
    "hello",
    "--wait-idle",
  ]);

  assert.equal(options.threadId, "thread-3");
  assert.equal(options.text, "hello");
  assert.equal(options.waitIdle, true);
});

test("parseSimpleTurnStartArgs extracts thread and text", () => {
  const options = parseSimpleTurnStartArgs([
    "--thread",
    "thread-4",
    "--text",
    "ping",
  ]);

  assert.equal(options.threadId, "thread-4");
  assert.equal(options.text, "ping");
});

test("parseCodexSendArgs extracts thread or cwd modes", () => {
  const byThread = parseCodexSendArgs([
    "--thread",
    "thread-9",
    "--text",
    "hello",
    "--title",
    "t1",
  ]);
  assert.equal(byThread.threadId, "thread-9");
  assert.equal(byThread.text, "hello");
  assert.equal(byThread.title, "t1");

  const byCwd = parseCodexSendArgs([
    "--cwd",
    "C:\\repo",
    "--text",
    "hello2",
  ]);
  assert.equal(byCwd.cwd, "C:\\repo");
  assert.equal(byCwd.text, "hello2");
});

test("parseProjectThreadStartArgs extracts cwd, text, and title", () => {
  const options = parseProjectThreadStartArgs([
    "--cwd",
    "C:\\repo",
    "--text",
    "hello3",
    "--title",
    "old-thread-test A 2026-05-25 01:02:34",
  ]);

  assert.equal(options.cwd, "C:\\repo");
  assert.equal(options.text, "hello3");
  assert.equal(options.title, "old-thread-test A 2026-05-25 01:02:34");
});

test("parseSdkListenArgs extracts thread, filter, and poll interval", () => {
  const options = parseSdkListenArgs([
    "--thread",
    "thread-11",
    "--to",
    "user-11",
    "--poll-ms",
    "1500",
  ]);

  assert.equal(options.threadId, "thread-11");
  assert.equal(options.to, "user-11");
  assert.equal(options.pollMs, 1500);
});

test("resolveCodexCliPath falls back to direct Windows install path", () => {
  const previousCodexCliPath = process.env.CODEX_CLI_PATH;
  delete process.env.CODEX_CLI_PATH;

  const resolved = resolveCodexCliPath({
    platform: "win32",
    localAppData: "C:\\Users\\weich\\AppData\\Local",
    pathExists: (path) =>
      path === "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
    readDirNames: () => [],
  });

  if (previousCodexCliPath === undefined) {
    delete process.env.CODEX_CLI_PATH;
  } else {
    process.env.CODEX_CLI_PATH = previousCodexCliPath;
  }

  assert.equal(
    resolved,
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
  );
});

test("resolveCodexCliPath falls back to latest versioned Windows install path", () => {
  const previousCodexCliPath = process.env.CODEX_CLI_PATH;
  delete process.env.CODEX_CLI_PATH;

  const existing = new Set([
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\old\\codex.exe",
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\zzz\\codex.exe",
  ]);

  const resolved = resolveCodexCliPath({
    platform: "win32",
    localAppData: "C:\\Users\\weich\\AppData\\Local",
    pathExists: (path) => existing.has(path),
    readDirNames: () => ["old", "zzz"],
  });

  if (previousCodexCliPath === undefined) {
    delete process.env.CODEX_CLI_PATH;
  } else {
    process.env.CODEX_CLI_PATH = previousCodexCliPath;
  }

  assert.equal(
    resolved,
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\zzz\\codex.exe",
  );
});

test("startTurn resumes thread before sending user input", async () => {
  const client = new CodexAppServerClient("codex-test");
  const requestsSeen: Array<Record<string, unknown>> = [];
  let waitResolved = false;

  (
    client as unknown as {
      sendRequests: (
        requests: Array<Record<string, unknown>>,
        options?: {
          waitForNotification?: (
            message: unknown,
            results: Array<Record<string, unknown>>,
          ) => boolean;
        },
      ) => Promise<unknown[]>;
    }
  ).sendRequests = async (
    requests: Array<Record<string, unknown>>,
    options?: {
      waitForNotification?: (
        message: unknown,
        results: Array<Record<string, unknown>>,
      ) => boolean;
    },
  ) => {
      requestsSeen.push(...requests);
      const results = [{}, { turn: { id: "turn-456", status: { type: "inProgress" } } }];
      waitResolved = Boolean(
        options?.waitForNotification?.(
          {
            method: "turn/completed",
            params: {
              threadId: "thread-123",
              turnId: "turn-456",
            },
          },
          results,
        ),
      );
      return results;
    };

  await client.startTurn("thread-123", "111");

  assert.equal(requestsSeen.length, 2);
  assert.equal(waitResolved, true);
  assert.deepEqual(requestsSeen[0], {
    request: {
      method: "thread/resume",
      params: {
        threadId: "thread-123",
        cwd: undefined,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      },
    },
    delayAfterMs: 800,
  });
  assert.deepEqual(requestsSeen[1], {
    method: "turn/start",
    params: {
      threadId: "thread-123",
      input: [
        {
          type: "text",
          text: "111",
        },
      ],
      cwd: undefined,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      title: undefined,
    },
  });
});

test("waitUntilThreadIdle waits for idle notification", async () => {
  const client = new CodexAppServerClient("codex-test");
  const requestsSeen: Array<Record<string, unknown>> = [];
  let waitResolved = false;

  (
    client as unknown as {
      sendRequests: (
        requests: Array<Record<string, unknown>>,
        options?: {
          waitForNotification?: (message: unknown) => boolean;
        },
      ) => Promise<unknown[]>;
    }
  ).sendRequests = async (
    requests: Array<Record<string, unknown>>,
    options?: {
      waitForNotification?: (message: unknown) => boolean;
    },
  ) => {
    requestsSeen.push(...requests);
    waitResolved = Boolean(
      options?.waitForNotification?.({
        method: "thread/status/changed",
        params: {
          threadId: "thread-123",
          status: {
            type: "idle",
          },
        },
      }),
    );
    return [{}];
  };

  await client.waitUntilThreadIdle("thread-123");

  assert.equal(waitResolved, true);
  assert.deepEqual(requestsSeen[0], {
    method: "thread/resume",
    params: {
      threadId: "thread-123",
    },
  });
});

test("startProjectThread starts thread first and then injects first turn with real thread id", async () => {
  const client = new CodexAppServerClient("codex-test");
  const requestsSeen: Array<Array<Record<string, unknown>>> = [];
  let waitResolved = false;

  (
    client as unknown as {
      sendRequests: (
        requests: Array<Record<string, unknown> | { request: unknown; delayAfterMs?: number }>,
        options?: {
          waitForNotification?: (
            message: unknown,
            results: Array<Record<string, unknown>>,
          ) => boolean;
        },
      ) => Promise<unknown[]>;
    }
  ).sendRequests = async (
    requests: Array<Record<string, unknown> | { request: unknown; delayAfterMs?: number }>,
    options?: {
      waitForNotification?: (
        message: unknown,
        results: Array<Record<string, unknown>>,
      ) => boolean;
    },
  ) => {
    const first = requests[0] as { request: Record<string, unknown>; delayAfterMs?: number };
    const second = requests[1] as { request: (results: unknown[]) => Record<string, unknown> };
    const results = [
      {
        thread: {
          id: "thread-real-1",
          path: "C:\\sessions\\1.jsonl",
        },
      },
      {
        turn: {
          id: "turn-real-1",
        },
      },
    ];

    requestsSeen.push([
      first.request,
      second.request(results),
    ]);
    waitResolved = Boolean(
      options?.waitForNotification?.(
        {
          method: "turn/completed",
          params: {
            threadId: "thread-real-1",
            turnId: "turn-real-1",
          },
        },
        results,
      ),
    );

    return results;
  };

  const result = await client.startProjectThread({
    cwd: "C:\\repo",
    text: "first message",
    title: "hello",
  });

  assert.equal(waitResolved, true);
  assert.deepEqual(requestsSeen[0], [
    {
      method: "thread/start",
      params: {
        cwd: "C:\\repo",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      },
    },
    {
      method: "turn/start",
      params: {
        threadId: "thread-real-1",
        input: [
          {
            type: "text",
            text: "first message",
          },
        ],
        cwd: "C:\\repo",
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "dangerFullAccess",
        },
        title: "hello",
      },
    },
  ]);
  assert.deepEqual(result, {
    threadId: "thread-real-1",
    path: "C:\\sessions\\1.jsonl",
  });
});
