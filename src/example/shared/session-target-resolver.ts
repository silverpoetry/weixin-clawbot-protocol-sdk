import type { ClawbotClient, MessageItem, WeixinMessage } from "../../sdk/index.js";
import { loadConversationState, saveConversationState, type ConversationState } from "./conversation-state-store.js";

export interface SessionTarget {
  toUserId: string;
  contextToken: string;
  sourceMessage?: WeixinMessage;
  source: "fresh" | "stored";
}

export interface ConversationStateStore {
  load: () => ConversationState;
  save: (state: ConversationState) => void;
}

export interface WaitForFreshSessionTargetOptions {
  toUserId: string;
  previousContextToken?: string;
  timeoutMs: number;
  pollTimeoutMs?: number;
}

function hasText(items: MessageItem[] | undefined): boolean {
  return Boolean(
    items?.some((item) => item.type === 1 && item.text_item?.text && item.text_item.text.trim()),
  );
}

function extractText(items: MessageItem[] | undefined): string | undefined {
  const text = items
    ?.filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item?.text?.trim())
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

export async function resolveLatestSessionTarget(
  client: Pick<ClawbotClient, "getUpdates">,
  stateStore: ConversationStateStore = {
    load: loadConversationState,
    save: saveConversationState,
  },
): Promise<SessionTarget> {
  const previousState = stateStore.load();
  const updates = await client.getUpdates(previousState.getUpdatesBuf);
  const messages = updates.msgs ?? [];

  const candidates = messages
    .filter((msg) => msg.from_user_id && msg.context_token && hasText(msg.item_list))
    .sort((a, b) => (b.create_time_ms ?? 0) - (a.create_time_ms ?? 0));

  const latest = candidates[0];
  const nextState: ConversationState = {
    ...previousState,
    getUpdatesBuf: updates.get_updates_buf || previousState.getUpdatesBuf,
    updatedAt: new Date().toISOString(),
  };

  if (latest?.from_user_id && latest.context_token) {
    nextState.toUserId = latest.from_user_id;
    nextState.contextToken = latest.context_token;
    nextState.lastMessageId = latest.message_id;
    nextState.lastMessageAt = latest.create_time_ms;
    nextState.lastMessageText = extractText(latest.item_list);
    stateStore.save(nextState);

    return {
      toUserId: latest.from_user_id,
      contextToken: latest.context_token,
      sourceMessage: latest,
      source: "fresh",
    };
  }

  if (nextState.toUserId && nextState.contextToken) {
    stateStore.save(nextState);
    return {
      toUserId: nextState.toUserId,
      contextToken: nextState.contextToken,
      source: "stored",
    };
  }

  stateStore.save(nextState);
  throw new Error("No inbound WeChat conversation found. Send a message to the bound bot first, then retry.");
}

export function hasStoredSessionTarget(
  stateStore: ConversationStateStore = {
    load: loadConversationState,
    save: saveConversationState,
  },
): boolean {
  const state = stateStore.load();
  return Boolean(state.toUserId && state.contextToken);
}

export function loadStoredSessionTarget(
  toUserId?: string,
  stateStore: ConversationStateStore = {
    load: loadConversationState,
    save: saveConversationState,
  },
): SessionTarget | undefined {
  const state = stateStore.load();
  if (!state.toUserId || !state.contextToken) {
    return undefined;
  }

  if (toUserId && state.toUserId !== toUserId) {
    return undefined;
  }

  return {
    toUserId: state.toUserId,
    contextToken: state.contextToken,
    source: "stored",
  };
}

export async function waitForFreshSessionTarget(
  client: Pick<ClawbotClient, "getUpdates">,
  options: WaitForFreshSessionTargetOptions,
  stateStore: ConversationStateStore = {
    load: loadConversationState,
    save: saveConversationState,
  },
): Promise<SessionTarget> {
  const deadline = Date.now() + options.timeoutMs;
  const pollTimeoutMs = options.pollTimeoutMs ?? 5_000;
  let previousState = stateStore.load();

  while (Date.now() < deadline) {
    let updates;
    try {
      updates = await client.getUpdates(
        previousState.getUpdatesBuf,
        Math.min(pollTimeoutMs, Math.max(1, deadline - Date.now())),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Request timed out")) {
        continue;
      }
      throw error;
    }
    const messages = updates.msgs ?? [];
    const candidates = messages
      .filter(
        (msg) =>
          msg.from_user_id === options.toUserId &&
          msg.context_token &&
          hasText(msg.item_list) &&
          msg.context_token !== options.previousContextToken,
      )
      .sort((a, b) => (b.create_time_ms ?? 0) - (a.create_time_ms ?? 0));

    const nextState: ConversationState = {
      ...previousState,
      getUpdatesBuf: updates.get_updates_buf || previousState.getUpdatesBuf,
      updatedAt: new Date().toISOString(),
    };

    const latest = candidates[0];
    if (latest?.from_user_id && latest.context_token) {
      nextState.toUserId = latest.from_user_id;
      nextState.contextToken = latest.context_token;
      nextState.lastMessageId = latest.message_id;
      nextState.lastMessageAt = latest.create_time_ms;
      nextState.lastMessageText = extractText(latest.item_list);
      stateStore.save(nextState);
      return {
        toUserId: latest.from_user_id,
        contextToken: latest.context_token,
        sourceMessage: latest,
        source: "fresh",
      };
    }

    stateStore.save(nextState);
    previousState = nextState;
  }

  throw new Error(`Timed out waiting for a fresh session target for ${options.toUserId}.`);
}
