import type { WeChatApi } from "./api.js";
import { loadConversationState, saveConversationState, type ConversationState } from "./conversation-state.js";
import type { MessageItem, WeixinMessage } from "./types.js";

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

function hasText(items: MessageItem[] | undefined): boolean {
  return Boolean(
    items?.some((item) => item.type === 1 && item.text_item?.text && item.text_item.text.trim()),
  );
}

export async function resolveLatestSessionTarget(
  api: Pick<WeChatApi, "getUpdates">,
  stateStore: ConversationStateStore = {
    load: loadConversationState,
    save: saveConversationState,
  },
): Promise<SessionTarget> {
  const previousState = stateStore.load();
  const updates = await api.getUpdates(previousState.getUpdatesBuf);
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

function extractText(items: MessageItem[] | undefined): string | undefined {
  const text = items
    ?.filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item?.text?.trim())
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

export function clearConversationState(): void {
  saveConversationState({});
}
