import process from "node:process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./codex-app-server.js";

export interface ProjectThreadStartOptions {
  cwd?: string;
  text?: string;
  title?: string;
}

export function parseProjectThreadStartArgs(argv: string[]): ProjectThreadStartOptions {
  const options: ProjectThreadStartOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

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

export async function runProjectThreadStartCli(argv: string[]): Promise<void> {
  const options = parseProjectThreadStartArgs(argv);
  if (!options.cwd) {
    throw new Error("Missing required --cwd <projectPath>.");
  }

  if (!options.text) {
    throw new Error("Missing required --text <text>.");
  }

  const codex = new CodexAppServerClient();
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
  runProjectThreadStartCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
