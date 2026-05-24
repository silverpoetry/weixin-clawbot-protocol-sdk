import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { DEFAULT_BASE_URL, getAccountsDir } from "./constants.js";
import { loadJson, saveJson } from "./store.js";

export interface AccountData {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId: string;
  createdAt: string;
}

function validateAccountId(accountId: string): void {
  if (!/^[a-zA-Z0-9_.@=-]+$/.test(accountId)) {
    throw new Error(`Invalid accountId: "${accountId}"`);
  }
}

function accountPath(accountId: string): string {
  validateAccountId(accountId);
  return join(getAccountsDir(), `${accountId}.json`);
}

export function saveAccount(data: AccountData): void {
  saveJson(accountPath(data.accountId), {
    ...data,
    baseUrl: data.baseUrl || DEFAULT_BASE_URL,
  });
}

export function loadAccount(accountId: string): AccountData | null {
  return loadJson<AccountData | null>(accountPath(accountId), null);
}

export function loadLatestAccount(): AccountData | null {
  try {
    const accountsDir = getAccountsDir();
    const files = readdirSync(accountsDir).filter((file) => file.endsWith(".json"));
    if (files.length === 0) {
      return null;
    }

    let latestFile = files[0]!;
    let latestTime = 0;
    for (const file of files) {
      const time = statSync(join(accountsDir, file)).mtimeMs;
      if (time > latestTime) {
        latestTime = time;
        latestFile = file;
      }
    }

    return loadAccount(latestFile.replace(/\.json$/, ""));
  } catch {
    return null;
  }
}
