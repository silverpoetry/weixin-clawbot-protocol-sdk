import process from "node:process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ClawbotApiError, ClawbotClient } from "../../sdk/index.js";
import { loadAccount, loadLatestAccount } from "../shared/account-store.js";
import { loadConfig, loadDotEnv } from "../shared/config.js";
import { loadConversationState, saveConversationState } from "../shared/conversation-state-store.js";
import {
  loadStoredSessionTarget,
  waitForFreshSessionTarget,
} from "../shared/session-target-resolver.js";
import { runCodexDesktopAutomationCli } from "../codex-desktop-automation/cli.js";
import { runWechatAutomationCli } from "../wechat-automation/cli.js";
import {
  extractCodexHookNotification,
  formatCodexHookNotification,
  parseCodexHookInput,
} from "./index.js";
import {
  type HookDaemonEnvelope,
  type HookQueueEntry,
  clearStaleInboxItem,
  daemonDataFile,
  enqueueDaemonInbox,
  fileExists,
  listDaemonInboxPaths,
  listDaemonQueuePaths,
  loadDaemonEnvelope,
  loadQueueEntry,
  logDaemonDebug,
  markQueueEntryFailed,
  markQueueEntrySent,
  moveInboxItemToQueue,
  readJsonFile,
  releaseDaemonLock,
  tryAcquireDaemonLock,
  updateQueueEntry,
} from "./daemon-store.js";
import type { MessageItem, WeixinMessage } from "../../sdk/index.js";

export interface CodexHookDaemonOptions {
  pollMs: number;
  inboundTo?: string;
}

interface PendingQueueEntry {
  path: string;
  entry: HookQueueEntry;
}

interface ReactivationState {
  triggeredAt?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalConfigValue(
  env: NodeJS.ProcessEnv,
  fileValues: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] || fileValues[key];
}

function extractText(items: MessageItem[] | undefined): string | undefined {
  const text = items
    ?.filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item?.text?.trim())
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function isRetryableSessionError(error: unknown): boolean {
  if (error instanceof ClawbotApiError) {
    return error.response.errcode === -14 || error.response.ret === -2;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("session timeout") || error.message.includes("ret=-2");
}

function truncate(text: string, maxLength = 3500): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function buildMergedHookMessage(entries: HookQueueEntry[]): string {
  const parts = entries.map((entry, index) => {
    const notification = extractCodexHookNotification(parseCodexHookInput(entry.rawInput));
    const formatted = formatCodexHookNotification(notification);
    return `【${index + 1}/${entries.length}】\n${formatted}`;
  });

  const merged = entries.length === 1
    ? parts[0]!
    : `[Codex积压消息 x${entries.length}]\n\n${parts.join("\n\n----------------\n\n")}`;

  return truncate(merged);
}

function parseDaemonArgs(argv: string[]): CodexHookDaemonOptions {
  const options: CodexHookDaemonOptions = {
    pollMs: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--poll-ms" && next) {
      options.pollMs = Number(next);
      i += 1;
      continue;
    }

    if (arg === "--inbound-to" && next) {
      options.inboundTo = next;
      i += 1;
    }
  }

  return options;
}

function listPendingQueueEntries(): PendingQueueEntry[] {
  return listDaemonQueuePaths().map((path) => ({
    path,
    entry: loadQueueEntry(path),
  }));
}

function groupQueueEntriesByTarget(entries: PendingQueueEntry[]): PendingQueueEntry[][] {
  const groups = new Map<string, PendingQueueEntry[]>();
  for (const pending of entries) {
    const key = `${pending.entry.accountId}::${pending.entry.target.toUserId}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(pending);
    } else {
      groups.set(key, [pending]);
    }
  }

  return [...groups.values()];
}

function getReactivationStatePath(targetName: string): string {
  const safe = Buffer.from(targetName, "utf8").toString("hex");
  return daemonDataFile(`reactivation-${safe}.json`);
}

function readReactivationState(targetName: string): ReactivationState {
  const path = getReactivationStatePath(targetName);
  return fileExists(path) ? readJsonFile<ReactivationState>(path) : {};
}

function writeReactivationState(targetName: string, state: ReactivationState): void {
  const path = getReactivationStatePath(targetName);
  const content = `${JSON.stringify(state, null, 2)}\n`;
  writeFileSync(path, content, "utf8");
}

function loadHookReactivationOptions(): { to: string; text: string; cooldownMs: number } {
  const dotEnv = loadDotEnv();
  const rawCooldown = readOptionalConfigValue(
    process.env,
    dotEnv,
    "WECHAT_HOOK_REACTIVATE_MIN_INTERVAL_MS",
  );

  return {
    to:
      readOptionalConfigValue(process.env, dotEnv, "WECHAT_HOOK_REACTIVATE_TO") ||
      readOptionalConfigValue(process.env, dotEnv, "WECHAT_AUTOMATION_TO") ||
      "微信ClawBot",
    text: readOptionalConfigValue(process.env, dotEnv, "WECHAT_HOOK_REACTIVATE_TEXT") || "1",
    cooldownMs: rawCooldown ? Number(rawCooldown) || 10_000 : 10_000,
  };
}

async function triggerWechatReactivation(toUserId: string, contextToken?: string): Promise<boolean> {
  const options = loadHookReactivationOptions();
  const current = readReactivationState(options.to);
  const triggeredAtMs = current.triggeredAt ? Date.parse(current.triggeredAt) : Number.NaN;
  if (Number.isFinite(triggeredAtMs) && Date.now() - triggeredAtMs < options.cooldownMs) {
    logDaemonDebug(`reactivation:throttled to=${options.to} sourceToUserId=${toUserId}`);
    return false;
  }

  const text = options.text
    .replaceAll("{toUserId}", toUserId)
    .replaceAll("{contextToken}", contextToken || "");

  logDaemonDebug(`reactivation:start to=${options.to} sourceToUserId=${toUserId} text=${JSON.stringify(text)}`);
  await runWechatAutomationCli([
    "--to",
    options.to,
    "--content",
    text,
  ]);
  writeReactivationState(options.to, { triggeredAt: new Date().toISOString() });
  logDaemonDebug(`reactivation:ok to=${options.to} sourceToUserId=${toUserId}`);
  return true;
}

async function deliverQueueGroup(entries: PendingQueueEntry[]): Promise<void> {
  const first = entries[0];
  if (!first) {
    return;
  }

  const queueEntry = first.entry;
  const account = loadAccount(queueEntry.accountId);
  if (!account) {
    throw new Error(`Account not found for daemon queue item: ${queueEntry.accountId}`);
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl);
  const text = buildMergedHookMessage(entries.map((pending) => pending.entry));
  let contextToken = queueEntry.target.contextToken;
  let reactivationAttemptedForToken: string | undefined;
  const deadlineMs = Math.min(...entries.map((pending) => Date.parse(pending.entry.deliverUntil)));

  for (;;) {
    if (!contextToken) {
      const stored = loadStoredSessionTarget(queueEntry.target.toUserId);
      contextToken = stored?.contextToken;
      logDaemonDebug(`queue:loadStoredToken toUserId=${queueEntry.target.toUserId} token=${contextToken || ""}`);
    }

    if (!contextToken) {
      logDaemonDebug(`queue:waitFresh:noToken toUserId=${queueEntry.target.toUserId}`);
      const fresh = await waitForFreshSessionTarget(client, {
        toUserId: queueEntry.target.toUserId,
        timeoutMs: Math.max(0, deadlineMs - Date.now()),
      });
      contextToken = fresh.contextToken;
      logDaemonDebug(`queue:waitFresh:noToken:ok toUserId=${queueEntry.target.toUserId} token=${contextToken}`);
    }

    try {
      logDaemonDebug(`queue:send:attempt toUserId=${queueEntry.target.toUserId} token=${contextToken}`);
      await client.sendMessage({
        msg: {
          from_user_id: queueEntry.accountId,
          to_user_id: queueEntry.target.toUserId,
          client_id: `codex-hook-daemon-${Date.now()}`,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [
            {
              type: 1,
              text_item: {
                text,
              },
            },
          ],
        },
      });
      logDaemonDebug(`queue:send:ok toUserId=${queueEntry.target.toUserId} token=${contextToken}`);
      for (const pending of entries) {
        markQueueEntrySent(pending.path);
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDaemonDebug(`queue:send:error toUserId=${queueEntry.target.toUserId} token=${contextToken || ""} error=${JSON.stringify(message)}`);
      if (!isRetryableSessionError(error)) {
        throw error;
      }

      if (reactivationAttemptedForToken !== contextToken) {
        reactivationAttemptedForToken = contextToken;
        try {
          await triggerWechatReactivation(queueEntry.target.toUserId, contextToken);
        } catch (reactivationError) {
          const reactivationMessage =
            reactivationError instanceof Error ? reactivationError.message : String(reactivationError);
          logDaemonDebug(`reactivation:error toUserId=${queueEntry.target.toUserId} token=${contextToken || ""} error=${JSON.stringify(reactivationMessage)}`);
        }
      }

      if (Date.now() >= deadlineMs) {
        throw new Error(`Queued hook delivery timed out after waiting for a fresh context token: ${text}`);
      }

      const fresh = await waitForFreshSessionTarget(client, {
        toUserId: queueEntry.target.toUserId,
        previousContextToken: contextToken,
        timeoutMs: Math.max(0, deadlineMs - Date.now()),
      });
      contextToken = fresh.contextToken;
      logDaemonDebug(`queue:waitFresh:retry:ok toUserId=${queueEntry.target.toUserId} token=${contextToken}`);
    }
  }
}

async function pumpDaemonInbox(): Promise<void> {
  for (const path of listDaemonInboxPaths()) {
    try {
      const envelope = loadDaemonEnvelope(path);
      if (Date.parse(envelope.deliverUntil) <= Date.now()) {
        logDaemonDebug(`inbox:expired id=${envelope.id}`);
        clearStaleInboxItem(path);
        continue;
      }
      moveInboxItemToQueue(path);
      logDaemonDebug(`inbox:queued id=${envelope.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDaemonDebug(`inbox:error path=${path} error=${JSON.stringify(message)}`);
      clearStaleInboxItem(path);
    }
  }
}

async function pumpOutboundQueue(): Promise<void> {
  const now = Date.now();
  const eligible = listPendingQueueEntries().filter(({ entry }) => {
    if (Date.parse(entry.deliverUntil) <= now) {
      return true;
    }
    if (!entry.availableAfter) {
      return true;
    }
    const availableAt = Date.parse(entry.availableAfter);
    return !Number.isFinite(availableAt) || availableAt <= now;
  });

  for (const group of groupQueueEntriesByTarget(eligible)) {
    try {
      await deliverQueueGroup(group);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const pending of group) {
        if (Date.parse(pending.entry.deliverUntil) <= Date.now()) {
          markQueueEntryFailed(pending.path, message);
        } else {
          updateQueueEntry(pending.path, {
            ...pending.entry,
            attempts: (pending.entry.attempts || 0) + 1,
            availableAfter: new Date(Date.now() + 1000).toISOString(),
          });
        }
      }
      logDaemonDebug(`queue:group:error key=${group[0]?.entry.target.toUserId || "unknown"} error=${JSON.stringify(message)}`);
    }
  }

  for (const pending of listPendingQueueEntries()) {
    if (Date.parse(pending.entry.deliverUntil) <= Date.now()) {
      markQueueEntryFailed(pending.path, "Delivery deadline exceeded.");
    }
  }
}

function isEligibleInboundMessage(
  message: WeixinMessage,
  startupTimeMs: number,
  lastForwardedMessageId: number,
  expectedToUserId?: string,
): boolean {
  if (!message.from_user_id || !message.context_token) {
    return false;
  }

  if (expectedToUserId && message.from_user_id !== expectedToUserId) {
    return false;
  }

  if (typeof message.message_id === "number" && message.message_id <= lastForwardedMessageId) {
    return false;
  }

  if ((message.create_time_ms ?? 0) < startupTimeMs) {
    return false;
  }

  return Boolean(extractText(message.item_list));
}

async function pumpInboundWechatToCodex(
  client: ClawbotClient,
  startupTimeMs: number,
  options: CodexHookDaemonOptions,
): Promise<void> {
  const previousState = loadConversationState();
  let updates;
  try {
    updates = await client.getUpdates(
      previousState.getUpdatesBuf,
      Math.max(options.pollMs + 5000, 15_000),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Request timed out")) {
      return;
    }
    throw error;
  }

  const messages = updates.msgs ?? [];
  const nextState = {
    ...previousState,
    getUpdatesBuf: updates.get_updates_buf || previousState.getUpdatesBuf,
    updatedAt: new Date().toISOString(),
  };
  saveConversationState(nextState);

  let lastForwardedMessageId = previousState.lastMessageId ?? 0;
  const candidates = messages
    .filter((message) =>
      isEligibleInboundMessage(message, startupTimeMs, lastForwardedMessageId, options.inboundTo))
    .sort((a, b) => (a.create_time_ms ?? 0) - (b.create_time_ms ?? 0));

  for (const message of candidates) {
    const text = extractText(message.item_list);
    if (!text) {
      continue;
    }

    const trimmed = text.trim();
    lastForwardedMessageId = Math.max(lastForwardedMessageId, message.message_id ?? 0);
    saveConversationState({
      ...nextState,
      toUserId: message.from_user_id,
      contextToken: message.context_token,
      lastMessageId: message.message_id,
      lastMessageAt: message.create_time_ms,
      lastMessageText: text,
      updatedAt: new Date().toISOString(),
    });

    if (trimmed === "1") {
      logDaemonDebug(`inbound:refresh-only messageId=${message.message_id ?? "unknown"} toUserId=${message.from_user_id}`);
      continue;
    }

    logDaemonDebug(`inbound:forward:start messageId=${message.message_id ?? "unknown"} toUserId=${message.from_user_id}`);
    await runCodexDesktopAutomationCli(["--content", text]);
    logDaemonDebug(`inbound:forward:ok messageId=${message.message_id ?? "unknown"} toUserId=${message.from_user_id}`);
  }
}

export async function runCodexHookDaemon(argv: string[]): Promise<void> {
  const options = parseDaemonArgs(argv);
  if (!tryAcquireDaemonLock()) {
    throw new Error("codex-hook daemon is already running.");
  }

  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) {
    releaseDaemonLock();
    throw new Error("No bound account found. Run `node dist/src/example/send-message/cli.js setup` first.");
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl || config.baseUrl);
  const startupTimeMs = Date.now();
  logDaemonDebug(`daemon:start pid=${process.pid}`);

  try {
    for (;;) {
      await pumpDaemonInbox();
      await pumpOutboundQueue();
      await pumpInboundWechatToCodex(client, startupTimeMs, options);
      await sleep(options.pollMs);
    }
  } finally {
    logDaemonDebug(`daemon:stop pid=${process.pid}`);
    releaseDaemonLock();
  }
}

export function buildDaemonEnvelope(input: HookDaemonEnvelope): HookDaemonEnvelope {
  return input;
}

export function submitDaemonEnvelope(envelope: HookDaemonEnvelope): string {
  return enqueueDaemonInbox(envelope);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runCodexHookDaemon(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${randomUUID()} ${message}\n`);
    process.exitCode = 1;
  });
}
