import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_BASE_URL, getDataDir } from "../shared/constants.js";

export interface AppConfig {
  toUserId: string;
  contextToken: string;
  baseUrl: string;
  dataDir: string;
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx < 0) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    values[key] = value;
  }

  return values;
}

export function loadDotEnv(dotEnvPath = ".env"): Record<string, string> {
  const absolute = resolve(dotEnvPath);
  if (!existsSync(absolute)) {
    return {};
  }

  return parseEnvFile(readFileSync(absolute, "utf8"));
}

function readConfigValue(
  env: NodeJS.ProcessEnv,
  fileValues: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] || fileValues[key];
}

export function validateBaseUrl(baseUrl: string): string {
  if (!baseUrl.startsWith("https://")) {
    return DEFAULT_BASE_URL;
  }

  const hostname = new URL(baseUrl).hostname;
  if (!/(^|\.)weixin\.qq\.com$/.test(hostname) && !/(^|\.)wechat\.com$/.test(hostname)) {
    return DEFAULT_BASE_URL;
  }

  return baseUrl.replace(/\/+$/, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  dotEnvPath = ".env",
): AppConfig {
  const fileValues = loadDotEnv(dotEnvPath);

  return {
    toUserId: readConfigValue(env, fileValues, "WECHAT_TO_USER_ID") || "clawbot",
    contextToken: readConfigValue(env, fileValues, "WECHAT_CONTEXT_TOKEN") || "",
    baseUrl: validateBaseUrl(
      readConfigValue(env, fileValues, "WECHAT_BASE_URL") || DEFAULT_BASE_URL,
    ),
    dataDir: readConfigValue(env, fileValues, "WECHAT_MESSAGE_DATA_DIR") || getDataDir(),
  };
}
