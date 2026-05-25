import test from "node:test";
import assert from "node:assert/strict";
import { ClawbotApiError, ClawbotClient, TypingStatus, UploadMediaType } from "../src/index.js";

test("ClawbotClient getConfig sends expected payload", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0, typing_ticket: "ticket-1" }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com", {
      botAgent: "WeixinMessage/1.0",
      channelVersion: "1.0.0",
    });
    const config = await client.getConfig("user-1", "ctx-1");
    assert.equal(config.typing_ticket, "ticket-1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/getconfig");
  assert.equal(body.ilink_user_id, "user-1");
  assert.equal(body.context_token, "ctx-1");
  assert.equal(body.base_info.bot_agent, "WeixinMessage/1.0");
  assert.equal(body.base_info.channel_version, "1.0.0");
});

test("ClawbotClient sendTyping sends expected payload", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com");
    await client.sendTyping({
      ilink_user_id: "user-1",
      typing_ticket: "ticket-1",
      status: TypingStatus.TYPING,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping");
  assert.equal(body.ilink_user_id, "user-1");
  assert.equal(body.typing_ticket, "ticket-1");
  assert.equal(body.status, TypingStatus.TYPING);
});

test("ClawbotClient getUploadUrl sends expected payload", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0, upload_full_url: "https://upload.example.com" }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com");
    const response = await client.getUploadUrl({
      filekey: "file-1",
      media_type: UploadMediaType.IMAGE,
      to_user_id: "user-1",
      rawsize: 10,
      rawfilemd5: "abc",
      filesize: 16,
    });
    assert.equal(response.upload_full_url, "https://upload.example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl");
  assert.equal(body.filekey, "file-1");
  assert.equal(body.media_type, UploadMediaType.IMAGE);
});

test("ClawbotClient notifyStart and notifyStop hit expected endpoints", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com");
    await client.notifyStart();
    await client.notifyStop();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/msg/notifystart");
  assert.equal(calls[1]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/msg/notifystop");
});

test("ClawbotClient supports injected fetch implementations", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const injectedFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  }) as typeof fetch;

  const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com", {
    fetchImpl: injectedFetch,
  });
  await client.sendMessage({
    msg: {
      from_user_id: "bot-1",
      to_user_id: "user-1",
      client_id: "client-1",
      message_type: 2,
      message_state: 2,
      context_token: "ctx-1",
      item_list: [],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
});

test("ClawbotClient exposes raw response on API failures", async () => {
  const injectedFetch: typeof fetch = (async () =>
    new Response(JSON.stringify({ ret: -2, errcode: -14, errmsg: "session timeout" }), { status: 200 })) as typeof fetch;

  const client = new ClawbotClient("token-1", "https://ilinkai.weixin.qq.com", {
    fetchImpl: injectedFetch,
  });

  await assert.rejects(
    client.sendMessage({
      msg: {
        from_user_id: "bot-1",
        to_user_id: "user-1",
        client_id: "client-1",
        message_type: 2,
        message_state: 2,
        context_token: "ctx-1",
        item_list: [],
      },
    }),
    (error: unknown) =>
      error instanceof ClawbotApiError &&
      error.response.errcode === -14 &&
      error.response.errmsg === "session timeout",
  );
});
