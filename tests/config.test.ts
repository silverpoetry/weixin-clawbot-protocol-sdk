import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateBaseUrl } from "../src/example/config.js";

test("loadConfig reads values from .env file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wmsg-config-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    [
      "WECHAT_TO_USER_ID=clawbot",
      "WECHAT_CONTEXT_TOKEN=ctx-1",
      "WECHAT_BASE_URL=https://ilinkai.weixin.qq.com/",
      "WECHAT_MESSAGE_DATA_DIR=C:\\temp\\weixinmessage",
    ].join("\n"),
  );

  const config = loadConfig({}, envPath);
  assert.equal(config.toUserId, "clawbot");
  assert.equal(config.contextToken, "ctx-1");
  assert.equal(config.baseUrl, "https://ilinkai.weixin.qq.com");
  assert.equal(config.dataDir, "C:\\temp\\weixinmessage");
});

test("validateBaseUrl falls back for untrusted domains", () => {
  assert.equal(validateBaseUrl("https://example.com"), "https://ilinkai.weixin.qq.com");
  assert.equal(validateBaseUrl("http://ilinkai.weixin.qq.com"), "https://ilinkai.weixin.qq.com");
  assert.equal(validateBaseUrl("https://ilinkai.weixin.qq.com"), "https://ilinkai.weixin.qq.com");
});
