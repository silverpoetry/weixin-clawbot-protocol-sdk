import process from "node:process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface SimpleTurnStartOptions {
  threadId?: string;
  text?: string;
}

export function parseSimpleTurnStartArgs(argv: string[]): SimpleTurnStartOptions {
  const options: SimpleTurnStartOptions = {};

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
    }
  }

  return options;
}

export async function runSimpleTurnStartCli(argv: string[]): Promise<void> {
  const options = parseSimpleTurnStartArgs(argv);
  if (!options.threadId) {
    throw new Error("Missing required --thread <threadId>.");
  }

  if (!options.text) {
    throw new Error("Missing required --text <text>.");
  }

  const codex = new CodexAppServerClient();
  await codex.startTurn(options.threadId, options.text);
  process.stdout.write(
    `Started a new Codex turn in thread ${options.threadId} with text: ${options.text}\n`,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runSimpleTurnStartCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
