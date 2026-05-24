import type { ClawbotClient } from "../../sdk/index.js";
import { sendTextMessage } from "../../sdk/index.js";

export interface CodexHookNotification {
  eventType?: string;
  notificationType?: string;
  inferredKind: "need-reply" | "need-confirm" | "completed" | "error" | "generic";
  title?: string;
  body?: string;
  status?: string;
  sessionId?: string;
  transcriptPath?: string;
  model?: string;
  threadId?: string;
  turnId?: string;
  cwd?: string;
  toolName?: string;
  agentId?: string;
  agentType?: string;
  raw: unknown;
}

export interface HookTarget {
  toUserId: string;
  contextToken: string;
  source: "configured" | "session";
}

export interface ForwardCodexHookOptions {
  rawInput: string;
  client: Pick<ClawbotClient, "sendMessage">;
  accountId: string;
  target: HookTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWhitespace(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized : undefined;
}

function extractString(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeWhitespace(value) : undefined;
}

function stringifyPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  try {
    return normalizeWhitespace(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function getByPath(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function findFirstStringByPaths(
  record: Record<string, unknown>,
  paths: string[][],
): string | undefined {
  for (const path of paths) {
    const value = extractString(getByPath(record, path));
    if (value) {
      return value;
    }
  }

  return undefined;
}

function findFirstStringByKeys(
  value: unknown,
  keys: string[],
  maxDepth = 3,
): string | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !isRecord(current.value) || current.depth > maxDepth) {
      continue;
    }

    for (const key of keys) {
      const candidate = extractString(current.value[key]);
      if (candidate) {
        return candidate;
      }
    }

    for (const nested of Object.values(current.value)) {
      if (isRecord(nested)) {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }

  return undefined;
}

function inferKind(
  eventType: string | undefined,
  parts: Array<string | undefined>,
): CodexHookNotification["inferredKind"] {
  const haystack = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (eventType === "PermissionRequest") {
    return "need-confirm";
  }

  if (eventType === "UserPromptSubmit") {
    return "need-reply";
  }

  if (
    haystack.includes("confirm") ||
    haystack.includes("approval") ||
    haystack.includes("approve")
  ) {
    return "need-confirm";
  }

  if (
    haystack.includes("reply") ||
    haystack.includes("respond") ||
    haystack.includes("response") ||
    haystack.includes("answer") ||
    haystack.includes("input_required")
  ) {
    return "need-reply";
  }

  if (eventType === "Stop" || eventType === "SubagentStop") {
    return "completed";
  }

  if (
    haystack.includes("complete") ||
    haystack.includes("completed") ||
    haystack.includes("finish") ||
    haystack.includes("finished") ||
    haystack.includes("done")
  ) {
    return "completed";
  }

  if (haystack.includes("error") || haystack.includes("failed") || haystack.includes("failure")) {
    return "error";
  }

  return "generic";
}

function kindLabel(kind: CodexHookNotification["inferredKind"]): string {
  switch (kind) {
    case "need-reply":
      return "需要回复";
    case "need-confirm":
      return "需要确认";
    case "completed":
      return "已完成";
    case "error":
      return "异常";
    default:
      return "通知";
  }
}

function truncate(text: string, maxLength = 1500): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function summarizeMultiline(text: string | undefined, maxLines: number): string[] {
  if (!text) {
    return ["无"];
  }

  const rawLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return ["无"];
  }

  if (rawLines.length <= maxLines) {
    return rawLines;
  }

  const lines = rawLines.slice(0, maxLines);
  lines[maxLines - 1] = truncate(`${lines[maxLines - 1]} ...`, 240);
  return lines;
}

export function parseCodexHookInput(rawInput: string): unknown {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Empty Codex hook input.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { message: trimmed, type: "raw-text" };
  }
}

export function extractCodexHookNotification(raw: unknown): CodexHookNotification {
  if (!isRecord(raw)) {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return {
      inferredKind: inferKind(undefined, [text]),
      body: normalizeWhitespace(text),
      raw,
    };
  }

  const eventType =
    findFirstStringByPaths(raw, [
      ["hook_event_name"],
      ["hookEventName"],
      ["event"],
      ["event_type"],
      ["type"],
      ["name"],
      ["kind"],
    ]) || findFirstStringByKeys(raw, ["hook_event_name", "event", "type", "name", "kind"], 2);

  const sessionId =
    findFirstStringByPaths(raw, [["session_id"], ["sessionId"]]) ||
    findFirstStringByKeys(raw, ["session_id", "sessionId"], 2);

  const transcriptPath =
    findFirstStringByPaths(raw, [["transcript_path"], ["transcriptPath"]]) ||
    findFirstStringByKeys(raw, ["transcript_path", "transcriptPath"], 2);

  const model =
    findFirstStringByPaths(raw, [["model"]]) ||
    findFirstStringByKeys(raw, ["model"], 1);

  const notificationType =
    findFirstStringByPaths(raw, [
      ["notification", "type"],
      ["payload", "notification", "type"],
      ["payload", "type"],
      ["data", "notification", "type"],
      ["data", "type"],
    ]) || findFirstStringByKeys(raw, ["notification_type", "type"], 3);

  const toolName =
    findFirstStringByPaths(raw, [["tool_name"], ["toolName"]]) ||
    findFirstStringByKeys(raw, ["tool_name", "toolName"], 2);

  const agentId =
    findFirstStringByPaths(raw, [["agent_id"], ["agentId"]]) ||
    findFirstStringByKeys(raw, ["agent_id", "agentId"], 2);

  const agentType =
    findFirstStringByPaths(raw, [["agent_type"], ["agentType"]]) ||
    findFirstStringByKeys(raw, ["agent_type", "agentType"], 2);

  const title =
    findFirstStringByPaths(raw, [
      ["notification", "title"],
      ["payload", "notification", "title"],
      ["data", "notification", "title"],
      ["title"],
      ["summary"],
    ]) || findFirstStringByKeys(raw, ["title", "summary"], 3);

  const body =
    findFirstStringByPaths(raw, [
      ["notification", "message"],
      ["notification", "body"],
      ["payload", "notification", "message"],
      ["payload", "notification", "body"],
      ["payload", "message"],
      ["payload", "body"],
      ["data", "notification", "message"],
      ["data", "notification", "body"],
      ["data", "message"],
      ["data", "body"],
      ["message"],
      ["body"],
      ["text"],
      ["prompt"],
      ["last_assistant_message"],
      ["description"],
    ]) ||
    findFirstStringByKeys(
      raw,
      ["message", "body", "text", "prompt", "last_assistant_message", "description"],
      3,
    ) ||
    stringifyPreview(getByPath(raw, ["last_assistant_message"])) ||
    stringifyPreview(getByPath(raw, ["tool_response"])) ||
    stringifyPreview(getByPath(raw, ["tool_input"]));

  const status =
    findFirstStringByPaths(raw, [
      ["notification", "status"],
      ["payload", "status"],
      ["data", "status"],
      ["status"],
    ]) || findFirstStringByKeys(raw, ["status"], 2);

  const threadId =
    findFirstStringByPaths(raw, [["thread_id"], ["threadId"], ["conversation_id"], ["conversationId"]]) ||
    findFirstStringByKeys(raw, ["thread_id", "threadId", "conversation_id", "conversationId"], 2);

  const turnId =
    findFirstStringByPaths(raw, [["turn_id"], ["turnId"], ["submission_id"], ["submissionId"]]) ||
    findFirstStringByKeys(raw, ["turn_id", "turnId", "submission_id", "submissionId"], 2);

  const cwd =
    findFirstStringByPaths(raw, [["cwd"], ["workspace"], ["workspace_root"], ["workspaceRoot"]]) ||
    findFirstStringByKeys(raw, ["cwd", "workspace", "workspace_root", "workspaceRoot"], 2);

  const inferredKind = inferKind(eventType, [
    eventType,
    notificationType,
    title,
    body,
    status,
    toolName,
  ]);

  const resolvedTitle =
    title ||
    (eventType === "PermissionRequest" && toolName ? `Permission request: ${toolName}` : undefined) ||
    (eventType === "PostToolUse" && toolName ? `Tool finished: ${toolName}` : undefined) ||
    (eventType === "Stop" ? "Session stopped" : undefined) ||
    (eventType === "SubagentStop" ? "Subagent stopped" : undefined) ||
    (eventType === "SubagentStart" ? "Subagent started" : undefined);

  return {
    eventType,
    notificationType,
    inferredKind,
    title: resolvedTitle,
    body,
    status,
    sessionId,
    transcriptPath,
    model,
    threadId,
    turnId,
    cwd,
    toolName,
    agentId,
    agentType,
    raw,
  };
}

export function buildManualCodexHookNotification(text: string): CodexHookNotification {
  const body = normalizeWhitespace(text);
  if (!body) {
    throw new Error("Manual notification text is empty.");
  }

  return {
    eventType: "manual",
    notificationType: "manual",
    inferredKind: "generic",
    title: "Manual test",
    body,
    raw: {
      type: "manual",
      message: body,
    },
  };
}

export function formatCodexHookNotification(notification: CodexHookNotification): string {
  if (notification.eventType === "PostToolUse") {
    const lines = ["[Codex工具调用]"];
    lines.push(`工具: ${notification.toolName || notification.title || "unknown"}`);
    const summaryLines = summarizeMultiline(notification.body || notification.title, 3);
    lines.push(`内容: ${summaryLines[0]}`);
    for (const extraLine of summaryLines.slice(1)) {
      lines.push(extraLine);
    }
    return truncate(lines.join("\n"));
  }

  const lines = [`[Codex${kindLabel(notification.inferredKind)}]`];

  if (notification.notificationType) {
    lines.push(`类型: ${notification.notificationType}`);
  } else if (notification.eventType) {
    lines.push(`事件: ${notification.eventType}`);
  }

  if (notification.title) {
    lines.push(`标题: ${notification.title}`);
  }

  if (notification.body && notification.body !== notification.title) {
    lines.push(`内容: ${notification.body}`);
  }

  if (notification.status) {
    lines.push(`状态: ${notification.status}`);
  }

  if (notification.toolName) {
    lines.push(`工具: ${notification.toolName}`);
  }

  if (notification.agentType) {
    lines.push(`代理类型: ${notification.agentType}`);
  }

  if (notification.agentId) {
    lines.push(`代理ID: ${notification.agentId}`);
  }

  if (notification.threadId) {
    lines.push(`线程: ${notification.threadId}`);
  }

  if (notification.model) {
    lines.push(`模型: ${notification.model}`);
  }

  if (notification.cwd) {
    lines.push(`目录: ${notification.cwd}`);
  }

  return truncate(lines.join("\n"));
}

export async function forwardCodexHookNotification(
  options: ForwardCodexHookOptions,
): Promise<{ notification: CodexHookNotification; text: string }> {
  const notification = extractCodexHookNotification(parseCodexHookInput(options.rawInput));
  const text = formatCodexHookNotification(notification);

  await sendTextMessage(options.client, {
    fromUserId: options.accountId,
    toUserId: options.target.toUserId,
    contextToken: options.target.contextToken,
    text,
  });

  return { notification, text };
}
