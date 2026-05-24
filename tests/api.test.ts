import test from "node:test";
import assert from "node:assert/strict";
import { ClawbotClient } from "../src/sdk/client.js";

test("WeChatApi sends request with expected headers and body", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com");
    await client.sendMessage({
      msg: {
        from_user_id: "bot-1",
        to_user_id: "clawbot",
        client_id: "client-1",
        message_type: 2,
        message_state: 2,
        context_token: "",
        item_list: [],
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
  assert.equal(calls[0]?.init?.method, "POST");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-1");
  assert.equal(headers.AuthorizationType, "ilink_bot_token");
  assert.ok(typeof headers["X-WECHAT-UIN"] === "string");
  assert.match(headers["X-WECHAT-UIN"], /.+/);
});

test("WeChatApi throws when sendmessage ret is non-zero", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ret: -3 }), { status: 200 })) as typeof fetch;

  try {
  const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com");
  await assert.rejects(
      client.sendMessage({
        msg: {
          from_user_id: "bot-1",
          to_user_id: "clawbot",
          client_id: "client-1",
          message_type: 2,
          message_state: 2,
          context_token: "",
          item_list: [],
        },
      }),
      /ret=-3/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
