import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("saveAccount and loadLatestAccount persist and retrieve accounts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wmsg-account-"));
  process.env.WECHAT_MESSAGE_DATA_DIR = dir;

  const accountModule = await import(`../src/example/account-store.js?${Date.now()}`);
  const constantsModule = await import(`../src/shared/constants.js?${Date.now()}`);

  mkdirSync(constantsModule.getAccountsDir(), { recursive: true });
  accountModule.saveAccount({
    botToken: "token-1",
    accountId: "bot-1",
    baseUrl: "https://ilinkai.weixin.qq.com",
    userId: "user-1",
    createdAt: "2026-05-24T00:00:00.000Z",
  });
  accountModule.saveAccount({
    botToken: "token-2",
    accountId: "bot-2",
    baseUrl: "https://ilinkai.weixin.qq.com",
    userId: "user-2",
    createdAt: "2026-05-24T00:00:01.000Z",
  });

  utimesSync(
    join(constantsModule.getAccountsDir(), "bot-2.json"),
    new Date(),
    new Date(Date.now() + 1000),
  );

  const latest = accountModule.loadLatestAccount();
  assert.equal(latest?.accountId, "bot-2");

  delete process.env.WECHAT_MESSAGE_DATA_DIR;
});
