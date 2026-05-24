import test from "node:test";
import assert from "node:assert/strict";
import { buildSendTextRequest, sendTextMessage } from "../src/sdk/messages.js";
import { MessageItemType, MessageState, MessageType } from "../src/sdk/types.js";

test("buildSendTextRequest creates a bot text payload", () => {
  const req = buildSendTextRequest({
    fromUserId: "bot-1",
    toUserId: "clawbot",
    contextToken: "ctx-1",
    text: "helloworld",
  });

  assert.ok(req.msg);
  assert.equal(req.msg.from_user_id, "bot-1");
  assert.equal(req.msg.to_user_id, "clawbot");
  assert.equal(req.msg.context_token, "ctx-1");
  assert.equal(req.msg.message_type, MessageType.BOT);
  assert.equal(req.msg.message_state, MessageState.FINISH);
  assert.ok(req.msg.item_list);
  assert.equal(req.msg.item_list[0]?.type, MessageItemType.TEXT);
  assert.equal(req.msg.item_list[0]?.text_item?.text, "helloworld");
  assert.match(req.msg.client_id!, /^wmsg-/);
});

test("sendTextMessage passes the request to the api", async () => {
  let captured: unknown;
  const api = {
    async sendMessage(req: unknown) {
      captured = req;
      return {};
    },
  };

  await sendTextMessage(api, {
    fromUserId: "bot-1",
    toUserId: "clawbot",
    contextToken: "",
    text: "helloworld",
  });

  assert.ok(captured);
  const req = captured as ReturnType<typeof buildSendTextRequest>;
  assert.ok(req.msg);
  assert.equal(req.msg.to_user_id, "clawbot");
  assert.ok(req.msg.item_list);
  assert.equal(req.msg.item_list[0]?.text_item?.text, "helloworld");
});
