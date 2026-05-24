import { join } from "node:path";
import { getStateDir } from "../shared/constants.js";
import { loadJson, saveJson } from "../shared/store.js";

export interface ConversationState {
  toUserId?: string;
  contextToken?: string;
  lastMessageId?: number;
  lastMessageText?: string;
  lastMessageAt?: number;
  getUpdatesBuf?: string;
  updatedAt?: string;
}

const STATE_FILE = join(getStateDir(), "conversation.json");

export function loadConversationState(): ConversationState {
  return loadJson<ConversationState>(STATE_FILE, {});
}

export function saveConversationState(state: ConversationState): void {
  saveJson(STATE_FILE, state);
}
