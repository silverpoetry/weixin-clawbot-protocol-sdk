import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("conversation state persists to disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wmsg-state-"));
  process.env.WECHAT_MESSAGE_DATA_DIR = dir;

  const stateModule = await import(`../src/example/conversation-state-store.js?${Date.now()}`);
  stateModule.saveConversationState({
    toUserId: "user-1",
    contextToken: "ctx-1",
    getUpdatesBuf: "buf-1",
  });

  const loaded = stateModule.loadConversationState();
  assert.equal(loaded.toUserId, "user-1");
  assert.equal(loaded.contextToken, "ctx-1");
  assert.equal(loaded.getUpdatesBuf, "buf-1");

  delete process.env.WECHAT_MESSAGE_DATA_DIR;
});
