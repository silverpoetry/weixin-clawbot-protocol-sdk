import process from "node:process";
import { fileURLToPath } from "node:url";
import { ClawbotClient } from "../../sdk/index.js";
import { loadLatestAccount } from "../shared/account-store.js";
import {
  buildManualCodexHookNotification,
  extractCodexHookNotification,
  formatCodexHookNotification,
  forwardCodexHookNotification,
  parseCodexHookInput,
  type HookTarget,
} from "./index.js";
import { loadConfig, loadDotEnv } from "../shared/config.js";
import { resolveLatestSessionTarget } from "../shared/session-target-resolver.js";

export interface CodexHookCliOptions {
  to?: string;
  context?: string;
  text?: string;
  dryRun: boolean;
}

function isStructuredHookInput(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildHookOutput(rawInput: unknown): string | undefined {
  if (!isStructuredHookInput(rawInput)) {
    return undefined;
  }

  const eventName = rawInput.hook_event_name;
  if (eventName === "Stop" || eventName === "SubagentStop") {
    return JSON.stringify({ continue: true });
  }

  return undefined;
}

function readOptionalConfigValue(
  env: NodeJS.ProcessEnv,
  fileValues: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] || fileValues[key];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function parseCodexHookArgs(argv: string[]): CodexHookCliOptions {
  const options: CodexHookCliOptions = { dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--to" && next) {
      options.to = next;
      i += 1;
      continue;
    }

    if (arg === "--context" && next) {
      options.context = next;
      i += 1;
      continue;
    }

    if (arg === "--text" && next) {
      options.text = next;
      i += 1;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

async function resolveHookTarget(
  client: Pick<ClawbotClient, "getUpdates">,
  options: CodexHookCliOptions,
): Promise<HookTarget> {
  const dotEnv = loadDotEnv();
  const configuredTo = options.to || readOptionalConfigValue(process.env, dotEnv, "WECHAT_TO_USER_ID");
  const configuredContext =
    options.context || readOptionalConfigValue(process.env, dotEnv, "WECHAT_CONTEXT_TOKEN");

  if (configuredTo && configuredContext) {
    return {
      toUserId: configuredTo,
      contextToken: configuredContext,
      source: "configured",
    };
  }

  if ((configuredTo && !configuredContext) || (!configuredTo && configuredContext)) {
    throw new Error(
      "Both WECHAT_TO_USER_ID and WECHAT_CONTEXT_TOKEN must be set together when using an explicit Codex hook target.",
    );
  }

  const target = await resolveLatestSessionTarget(client);
  return {
    toUserId: target.toUserId,
    contextToken: target.contextToken,
    source: "session",
  };
}

export async function runCodexHookCli(argv: string[]): Promise<void> {
  const options = parseCodexHookArgs(argv);
  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) {
    throw new Error("No bound account found. Run `node dist/src/example/send-message/cli.js setup` first.");
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl || config.baseUrl);
  const target = await resolveHookTarget(client, options);

  if (options.text) {
    const text = formatCodexHookNotification(buildManualCodexHookNotification(options.text));
    if (options.dryRun) {
      process.stdout.write(`${text}\n`);
      return;
    }

    await forwardCodexHookNotification({
      rawInput: JSON.stringify({
        type: "manual",
        message: options.text,
      }),
      client,
      accountId: account.accountId,
      target,
    });

    process.stderr.write(`Forwarded manual Codex notification to ${target.toUserId}\n`);
    return;
  }

  const rawInput = await readStdin();
  const parsedInput = parseCodexHookInput(rawInput);
  if (options.dryRun) {
    const text = formatCodexHookNotification(
      extractCodexHookNotification(parsedInput),
    );
    process.stdout.write(`${text}\n`);
    return;
  }

  const { notification } = await forwardCodexHookNotification({
    rawInput,
    client,
    accountId: account.accountId,
    target,
  });

  const hookOutput = buildHookOutput(parsedInput);
  if (hookOutput) {
    process.stdout.write(`${hookOutput}\n`);
  }

  process.stderr.write(
    `Forwarded Codex notification to ${target.toUserId} (${notification.eventType || "unknown"}, ${notification.inferredKind}, ${target.source})\n`,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runCodexHookCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
