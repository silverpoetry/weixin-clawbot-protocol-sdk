import test from "node:test";
import assert from "node:assert/strict";
import { parseReplyBridgeArgs } from "../src/example/reply-bridge/cli.js";
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

test("resolveCodexCliPath falls back to direct Windows install path", () => {
  const resolved = resolveCodexCliPath({
    platform: "win32",
    localAppData: "C:\\Users\\weich\\AppData\\Local",
    pathExists: (path) =>
      path === "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
    readDirNames: () => [],
  });

  assert.equal(
    resolved,
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
  );
});

test("resolveCodexCliPath falls back to latest versioned Windows install path", () => {
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

  assert.equal(
    resolved,
    "C:\\Users\\weich\\AppData\\Local\\OpenAI\\Codex\\bin\\zzz\\codex.exe",
  );
});

test("startTurn resumes thread before sending user input", async () => {
  const client = new CodexAppServerClient("codex-test");
  const requestsSeen: Array<Record<string, unknown>> = [];

  (client as unknown as { sendRequests: (requests: Array<Record<string, unknown>>) => Promise<unknown[]> }).sendRequests =
    async (requests: Array<Record<string, unknown>>) => {
      requestsSeen.push(...requests);
      return [{}, {}];
    };

  await client.startTurn("thread-123", "111");

  assert.equal(requestsSeen.length, 2);
  assert.deepEqual(requestsSeen[0], {
    request: {
      method: "thread/resume",
      params: {
        threadId: "thread-123",
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
    },
  });
});
