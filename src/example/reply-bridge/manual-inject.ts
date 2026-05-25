import process from "node:process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface ManualInjectOptions {
  threadId?: string;
  text?: string;
  waitIdle: boolean;
}

export function parseManualInjectArgs(argv: string[]): ManualInjectOptions {
  const options: ManualInjectOptions = {
    waitIdle: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--thread" && next) {
      options.threadId = next;
      i += 1;
      continue;
    }

    if (arg === "--text" && next) {
      options.text = next;
      i += 1;
      continue;
    }

    if (arg === "--wait-idle") {
      options.waitIdle = true;
    }
  }

  return options;
}

export async function runManualInjectCli(argv: string[]): Promise<void> {
  const options = parseManualInjectArgs(argv);
  if (!options.threadId) {
    throw new Error("Missing required --thread <threadId>.");
  }

  if (!options.text) {
    throw new Error("Missing required --text <text>.");
  }

  const codex = new CodexAppServerClient();
  const thread = await codex.readThread(options.threadId);
  if (!thread.thread?.id) {
    throw new Error(`Codex thread not found: ${options.threadId}`);
  }

  if (options.waitIdle) {
    process.stdout.write(`Waiting for thread ${options.threadId} to become idle\n`);
    await codex.waitUntilThreadIdle(options.threadId);
    process.stdout.write(`Thread ${options.threadId} is idle\n`);
  }

  await codex.startTurn(options.threadId, options.text);
  process.stdout.write(`Injected "${options.text}" into thread ${options.threadId}\n`);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runManualInjectCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
