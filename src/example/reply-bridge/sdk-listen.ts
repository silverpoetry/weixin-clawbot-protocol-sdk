import process from "node:process";
import { fileURLToPath } from "node:url";
import { ClawbotClient, type MessageItem, type WeixinMessage } from "../../sdk/index.js";
import { loadLatestAccount } from "../shared/account-store.js";
import { loadConfig } from "../shared/config.js";
import { loadConversationState, saveConversationState } from "../shared/conversation-state-store.js";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface SdkListenOptions {
  threadId?: string;
  to?: string;
  pollMs: number;
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

export function parseSdkListenArgs(argv: string[]): SdkListenOptions {
  const options: SdkListenOptions = {
    pollMs: 1000,
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

    if (arg === "--poll-ms" && next) {
      options.pollMs = Number(next);
      i += 1;
    }
  }

  return options;
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

export async function runSdkListenCli(argv: string[]): Promise<void> {
  const options = parseSdkListenArgs(argv);
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
  const startupTimeMs = Date.now();
  let lastForwardedMessageId = loadConversationState().lastMessageId ?? 0;

  process.stdout.write(
    `Listening for WeChat replies via SDK and forwarding to Codex thread ${options.threadId}\n`,
  );

  while (true) {
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
        await sleep(options.pollMs);
        continue;
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

    const candidates = messages
      .filter((message) =>
        isEligibleInboundMessage(
          message,
          startupTimeMs,
          lastForwardedMessageId,
          options.to,
        ))
      .sort((a, b) => (a.create_time_ms ?? 0) - (b.create_time_ms ?? 0));

    for (const message of candidates) {
      const text = extractText(message.item_list);
      if (!text) {
        continue;
      }

      process.stdout.write(
        `WeChat inbound message ${message.message_id ?? "unknown"} received; waiting for Codex thread ${options.threadId} to become idle\n`,
      );
      await codex.waitUntilThreadIdle(options.threadId);
      await codex.startTurn(options.threadId, text);

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

      process.stdout.write(
        `Forwarded WeChat message ${message.message_id ?? "unknown"} to Codex thread ${options.threadId}\n`,
      );
    }

    await sleep(options.pollMs);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runSdkListenCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
