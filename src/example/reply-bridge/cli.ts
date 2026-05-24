import process from "node:process";
import { fileURLToPath } from "node:url";
import { ClawbotClient, type MessageItem, type WeixinMessage } from "../../sdk/index.js";
import { loadLatestAccount } from "../shared/account-store.js";
import { loadConfig } from "../shared/config.js";
import { loadConversationState, saveConversationState } from "../shared/conversation-state-store.js";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface ReplyBridgeCliOptions {
  threadId?: string;
  to?: string;
  aliveSeconds: number;
  pollIntervalMs: number;
  startupTimeMs: number;
}

function extractText(items: MessageItem[] | undefined): string | undefined {
  const text = items
    ?.filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item?.text?.trim())
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseReplyBridgeArgs(argv: string[]): ReplyBridgeCliOptions {
  const options: ReplyBridgeCliOptions = {
    aliveSeconds: 300,
    pollIntervalMs: 5000,
    startupTimeMs: Date.now(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--thread" && next) {
      options.threadId = next;
      i += 1;
      continue;
    }

    if (arg === "--to" && next) {
      options.to = next;
      i += 1;
      continue;
    }

    if (arg === "--alive-seconds" && next) {
      options.aliveSeconds = Number(next);
      i += 1;
      continue;
    }

    if (arg === "--poll-ms" && next) {
      options.pollIntervalMs = Number(next);
      i += 1;
    }
  }

  return options;
}

function isReplyAfterStartup(
  message: WeixinMessage,
  startupTimeMs: number,
  expectedToUserId?: string,
): boolean {
  if (!message.from_user_id || !message.context_token) {
    return false;
  }

  if (expectedToUserId && message.from_user_id !== expectedToUserId) {
    return false;
  }

  if ((message.create_time_ms ?? 0) < startupTimeMs) {
    return false;
  }

  return Boolean(extractText(message.item_list));
}

export async function runReplyBridgeCli(argv: string[]): Promise<void> {
  const options = parseReplyBridgeArgs(argv);
  if (!options.threadId) {
    throw new Error("Missing required --thread <threadId>.");
  }

  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) {
    throw new Error("No bound account found. Run `node dist/src/example/send-message/cli.js setup` first.");
  }

  const codex = new CodexAppServerClient();
  const thread = await codex.readThread(options.threadId);
  if (!thread.thread?.id) {
    throw new Error(`Codex thread not found: ${options.threadId}`);
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl || config.baseUrl);
  const deadline = Date.now() + options.aliveSeconds * 1000;

  while (Date.now() < deadline) {
    const previousState = loadConversationState();
    const updates = await client.getUpdates(previousState.getUpdatesBuf);
    const messages = updates.msgs ?? [];

    const nextState = {
      ...previousState,
      getUpdatesBuf: updates.get_updates_buf || previousState.getUpdatesBuf,
      updatedAt: new Date().toISOString(),
    };

    const candidates = messages
      .filter((message) => isReplyAfterStartup(message, options.startupTimeMs, options.to))
      .sort((a, b) => (b.create_time_ms ?? 0) - (a.create_time_ms ?? 0));

    const latest = candidates[0];
    if (latest) {
      nextState.toUserId = latest.from_user_id;
      nextState.contextToken = latest.context_token;
      nextState.lastMessageId = latest.message_id;
      nextState.lastMessageAt = latest.create_time_ms;
      nextState.lastMessageText = extractText(latest.item_list);
      saveConversationState(nextState);

      const replyText = nextState.lastMessageText;
      if (!replyText) {
        throw new Error("Received reply message without text payload.");
      }

      await codex.startTurn(options.threadId, replyText);
      process.stdout.write(
        `Forwarded WeChat reply to Codex thread ${options.threadId} from ${latest.from_user_id}\n`,
      );
      return;
    }

    saveConversationState(nextState);
    await sleep(options.pollIntervalMs);
  }

  process.stdout.write(
    `No new WeChat reply detected for thread ${options.threadId} within ${options.aliveSeconds}s\n`,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runReplyBridgeCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
