import process from "node:process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface CodexSendOptions {
  threadId?: string;
  cwd?: string;
  text?: string;
  title?: string;
}

export function parseCodexSendArgs(argv: string[]): CodexSendOptions {
  const options: CodexSendOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--thread" && next) {
      options.threadId = next;
      i += 1;
      continue;
    }

    if (arg === "--cwd" && next) {
      options.cwd = next;
      i += 1;
      continue;
    }

    if (arg === "--text" && next) {
      options.text = next;
      i += 1;
      continue;
    }

    if (arg === "--title" && next) {
      options.title = next;
      i += 1;
    }
  }

  return options;
}

export async function runCodexSendCli(argv: string[]): Promise<void> {
  const options = parseCodexSendArgs(argv);
  if (!options.text) {
    throw new Error("Missing required --text <text>.");
  }

  const codex = new CodexAppServerClient();

  if (options.threadId) {
    const thread = await codex.readThread(options.threadId);
    if (!thread.thread?.id) {
      throw new Error(`Codex thread not found: ${options.threadId}`);
    }

    await codex.startTurn(options.threadId, options.text, {
      cwd: options.cwd,
      title: options.title,
    });
    process.stdout.write(`Continued thread ${options.threadId}\n`);
    return;
  }

  if (!options.cwd) {
    throw new Error("Missing required --cwd <projectPath> when --thread is not provided.");
  }

  const result = await codex.startProjectThread({
    cwd: options.cwd,
    text: options.text,
    title: options.title,
  });

  process.stdout.write(`Started project thread ${result.threadId}\n`);
  if (result.path) {
    process.stdout.write(`Session path: ${result.path}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runCodexSendCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
