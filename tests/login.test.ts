import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("startQrLogin returns qr code payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ret: 0,
        qrcode: "qr-1",
        qrcode_img_content: "wechat-qr-content",
      }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const login = await import(`../src/login.js?${Date.now()}`);
    const result = await login.startQrLogin();
    assert.deepEqual(result, {
      qrcodeId: "qr-1",
      qrcodeUrl: "wechat-qr-content",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForQrScan saves account after confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wmsg-login-"));
  process.env.WECHAT_MESSAGE_DATA_DIR = dir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ ret: 0, status: "wait" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        ret: 0,
        status: "confirmed",
        bot_token: "token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "user-1",
        baseurl: "https://ilinkai.weixin.qq.com",
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const login = await import(`../src/login.js?${Date.now()}`);
    const account = await login.waitForQrScan("qr-1", 0);
    assert.equal(account.accountId, "bot-1");

    const accountModule = await import(`../src/account.js?${Date.now()}`);
    const latest = accountModule.loadLatestAccount();
    assert.equal(latest?.botToken, "token-1");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.WECHAT_MESSAGE_DATA_DIR;
  }
});
