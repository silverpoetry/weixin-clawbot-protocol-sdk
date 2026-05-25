import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractCodexHookNotification,
  formatCodexHookNotification,
  forwardCodexHookNotification,
  parseCodexHookInput,
} from "../src/example/codex-hook/index.js";
import { parseCodexHookArgs } from "../src/example/codex-hook/cli.js";
import { enqueueDaemonInbox, isDaemonRunning } from "../src/example/codex-hook/daemon-store.js";

test("parseCodexHookArgs extracts explicit hook options", () => {
  const options = parseCodexHookArgs([
    "--to",
    "user-1",
    "--context",
    "ctx-1",
    "--text",
    "manual notification",
    "--dry-run",
  ]);

  assert.deepEqual(options, {
    to: "user-1",
    context: "ctx-1",
    text: "manual notification",
    dryRun: true,
  });
});

test("parseCodexHookArgs defaults dryRun to false", () => {
  const options = parseCodexHookArgs([]);
  assert.deepEqual(options, { dryRun: false });
});

test("extractCodexHookNotification supports nested notification payloads", () => {
  const notification = extractCodexHookNotification(
    parseCodexHookInput(
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        notification: {
          type: "confirm",
          title: "Need confirmation",
          message: "Approve the pending command.",
        },
        session_id: "session-1",
        tool_name: "shell_command",
      }),
    ),
  );

  assert.equal(notification.eventType, "PermissionRequest");
  assert.equal(notification.notificationType, "confirm");
  assert.equal(notification.inferredKind, "need-confirm");
  assert.equal(notification.title, "Need confirmation");
  assert.equal(notification.body, "Approve the pending command.");
  assert.equal(notification.sessionId, "session-1");
  assert.equal(notification.toolName, "shell_command");
});

test("extractCodexHookNotification maps Stop to completed", () => {
  const notification = extractCodexHookNotification(
    parseCodexHookInput(
      JSON.stringify({
        hook_event_name: "Stop",
        last_assistant_message: "Task complete.",
        session_id: "session-2",
        cwd: "C:\\work",
      }),
    ),
  );

  assert.equal(notification.eventType, "Stop");
  assert.equal(notification.inferredKind, "completed");
  assert.equal(notification.title, "Session stopped");
  assert.equal(notification.body, "Task complete.");
  assert.equal(notification.sessionId, "session-2");
  assert.equal(notification.cwd, "C:\\work");
});

test("formatCodexHookNotification produces concise wechat text", () => {
  const text = formatCodexHookNotification({
    eventType: "Stop",
    inferredKind: "completed",
    title: "Task finished",
    body: "All checks passed.",
    sessionId: "session-1",
    turnId: "turn-1",
    transcriptPath: "C:\\logs\\session.jsonl",
    model: "gpt-5-codex",
    raw: {},
  });

  assert.match(text, /^\[Codex已完成\]/);
  assert.match(text, /事件: Stop/);
  assert.match(text, /标题: Task finished/);
  assert.match(text, /内容: All checks passed\./);
  assert.match(text, /模型: gpt-5-codex/);
  assert.doesNotMatch(text, /会话:/);
  assert.doesNotMatch(text, /回合:/);
  assert.doesNotMatch(text, /记录:/);
});

test("formatCodexHookNotification compresses PostToolUse into five lines max", () => {
  const text = formatCodexHookNotification({
    eventType: "PostToolUse",
    inferredKind: "generic",
    title: "Tool finished: Bash",
    body: "line1\nline2\nline3\nline4\nline5\nline6",
    toolName: "Bash",
    model: "gpt-5-codex",
    cwd: "C:\\work",
    raw: {},
  });

  const lines = text.split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "[Codex工具调用]");
  assert.equal(lines[1], "工具: Bash");
  assert.equal(lines[2], "内容: line1");
  assert.equal(lines[3], "line2");
  assert.match(lines[4] || "", /^line3/);
});

test("forwardCodexHookNotification sends formatted text through sdk client", async () => {
  let captured: unknown;
  const client = {
    async sendMessage(req: unknown) {
      captured = req;
      return {};
    },
  };

  const result = await forwardCodexHookNotification({
    rawInput: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "User asked a follow-up question.",
      session_id: "session-3",
    }),
    client,
    accountId: "bot-1",
    target: {
      toUserId: "user-1",
      contextToken: "ctx-1",
      source: "session",
    },
  });

  assert.equal(result.notification.inferredKind, "need-reply");
  assert.equal(result.notification.eventType, "UserPromptSubmit");
  assert.ok(captured);
  const request = captured as {
    msg?: {
      from_user_id?: string;
      to_user_id?: string;
      context_token?: string;
      item_list?: Array<{ text_item?: { text?: string } }>;
    };
  };
  assert.equal(request.msg?.from_user_id, "bot-1");
  assert.equal(request.msg?.to_user_id, "user-1");
  assert.equal(request.msg?.context_token, "ctx-1");
  assert.match(request.msg?.item_list?.[0]?.text_item?.text || "", /^\[Codex需要回复\]/);
});

test("hook daemon inbox accepts queue items", () => {
  const dir = mkdtempSync(join(tmpdir(), "wmsg-hook-daemon-"));
  process.env.WECHAT_MESSAGE_DATA_DIR = dir;

  const path = enqueueDaemonInbox({
    id: "task-1",
    createdAt: "2026-05-25T00:00:00.000Z",
    deliverUntil: "2026-05-25T00:10:00.000Z",
    rawInput: JSON.stringify({ hook_event_name: "Stop" }),
    accountId: "bot-1",
    target: {
      toUserId: "user-1",
      contextToken: "ctx-1",
      source: "stored",
    },
    type: "codex-hook",
  });

  assert.match(path, /codex-hook-daemon/);
  assert.equal(isDaemonRunning(), false);

  delete process.env.WECHAT_MESSAGE_DATA_DIR;
});
