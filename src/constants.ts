import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

export function getDataDir(): string {
  return process.env.WECHAT_MESSAGE_DATA_DIR || join(homedir(), ".weixinmessage");
}

export function getAccountsDir(): string {
  return join(getDataDir(), "accounts");
}

export function getStateDir(): string {
  return join(getDataDir(), "state");
}
