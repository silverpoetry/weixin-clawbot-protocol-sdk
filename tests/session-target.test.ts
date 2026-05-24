import test from "node:test";
import assert from "node:assert/strict";
import { resolveLatestSessionTarget } from "../src/example/shared/session-target-resolver.js";
import type { ConversationState } from "../src/example/shared/conversation-state-store.js";

test("resolveLatestSessionTarget returns latest inbound message target", async () => {
  let saved: ConversationState | undefined;
  const store = {
    load: () => ({}),
    save: (state: ConversationState) => {
      saved = state;
    },
  };

  const api = {
    async getUpdates() {
      return {
        ret: 0,
        get_updates_buf: "buf-1",
        msgs: [
          {
            from_user_id: "user-1",
            context_token: "ctx-1",
            create_time_ms: 1,
            item_list: [{ type: 1, text_item: { text: "older" } }],
          },
          {
            from_user_id: "user-2",
            context_token: "ctx-2",
            create_time_ms: 2,
            item_list: [{ type: 1, text_item: { text: "latest" } }],
          },
        ],
      };
    },
  };

  const target = await resolveLatestSessionTarget(api, store);
  assert.equal(target.toUserId, "user-2");
  assert.equal(target.contextToken, "ctx-2");
  assert.equal(target.source, "fresh");
  assert.equal(saved?.getUpdatesBuf, "buf-1");
});

test("resolveLatestSessionTarget reuses stored target when there are no new messages", async () => {
  let passedBuf: string | undefined;
  let saved: ConversationState | undefined;
  const store = {
    load: () => ({
      toUserId: "user-9",
      contextToken: "ctx-9",
      getUpdatesBuf: "buf-9",
    }),
    save: (state: ConversationState) => {
      saved = state;
    },
  };

  const api = {
    async getUpdates(buf?: string) {
      passedBuf = buf;
      return { ret: 0, get_updates_buf: "buf-10", msgs: [] };
    },
  };

  const target = await resolveLatestSessionTarget(api, store);
  assert.equal(passedBuf, "buf-9");
  assert.equal(target.toUserId, "user-9");
  assert.equal(target.contextToken, "ctx-9");
  assert.equal(target.source, "stored");
  assert.equal(saved?.getUpdatesBuf, "buf-10");
});

test("resolveLatestSessionTarget throws when no inbound conversation exists", async () => {
  let saved: ConversationState | undefined;
  const store = {
    load: () => ({}),
    save: (state: ConversationState) => {
      saved = state;
    },
  };
  const api = {
    async getUpdates() {
      return { ret: 0, get_updates_buf: "buf-empty", msgs: [] };
    },
  };

  await assert.rejects(resolveLatestSessionTarget(api, store), /No inbound WeChat conversation found/);
  assert.equal(saved?.getUpdatesBuf, "buf-empty");
});
