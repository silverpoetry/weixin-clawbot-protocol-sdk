import { MessageItemType, MessageState, MessageType, type SendMessageReq } from "./types.js";
import type { ClawbotClient } from "./client.js";

export interface SendTextInput {
  fromUserId: string;
  toUserId: string;
  contextToken: string;
  text: string;
}

function createClientId(): string {
  return `wmsg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSendTextRequest(input: SendTextInput): SendMessageReq {
  return {
    msg: {
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      client_id: createClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: input.contextToken,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: {
            text: input.text,
          },
        },
      ],
    },
  };
}

export async function sendTextMessage(
  client: Pick<ClawbotClient, "sendMessage">,
  input: SendTextInput,
): Promise<void> {
  const request = buildSendTextRequest(input);
  await client.sendMessage(request);
}
