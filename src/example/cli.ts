import process from "node:process";
import { fileURLToPath } from "node:url";
import qrcodeTerminal from "qrcode-terminal";
import { ClawbotClient, sendTextMessage, startQrLogin, waitForQrScan } from "../sdk/index.js";
import { loadConfig } from "./config.js";
import { saveAccount, loadLatestAccount } from "./account-store.js";
import { resolveLatestSessionTarget } from "./session-target-resolver.js";
import { loadConversationState } from "./conversation-state-store.js";

export interface CliOptions {
  command?: string;
  to?: string;
  text?: string;
  context?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (!arg.startsWith("--") && !options.command) {
      options.command = arg;
      continue;
    }

    if (arg === "--to" && next) {
      options.to = next;
      i += 1;
      continue;
    }

    if (arg === "--text" && next) {
      options.text = next;
      i += 1;
      continue;
    }

    if (arg === "--context" && next) {
      options.context = next;
      i += 1;
    }
  }

  return options;
}

async function runSetup(): Promise<void> {
  const { qrcodeId, qrcodeUrl } = await startQrLogin();
  process.stdout.write("请使用微信扫描下面的二维码完成绑定：\n\n");
  qrcodeTerminal.generate(qrcodeUrl, { small: true });
  process.stdout.write("\n等待扫码确认...\n");
  const account = await waitForQrScan(qrcodeId);
  saveAccount(account);
  process.stdout.write(`绑定成功，账号已保存: ${account.accountId}\n`);
}

export async function runCli(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.command === "setup") {
    await runSetup();
    return;
  }

  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) {
    throw new Error("No bound account found. Run `node dist/src/example/cli.js setup` first.");
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl || config.baseUrl);
  const text = options.text || "helloworld";
  const target = options.to
    ? {
        toUserId: options.to,
        contextToken: options.context ?? config.contextToken,
        source: "stored" as const,
      }
    : await resolveLatestSessionTarget(client);

  await sendTextMessage(client, {
    fromUserId: account.accountId,
    toUserId: target.toUserId,
    contextToken: target.contextToken,
    text,
  });

  const state = loadConversationState();
  const targetLabel = target.source === "fresh" ? "fresh session target" : "stored session target";
  process.stdout.write(
    `Sent "${text}" to ${target.toUserId} using ${targetLabel}${state.lastMessageText ? ` (last inbound: ${state.lastMessageText})` : ""}\n`,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
