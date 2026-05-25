import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDotEnv } from "../shared/config.js";

export interface CodexDesktopAutomationCliOptions {
  content?: string;
  scriptPath?: string;
  pythonCommand?: string;
}

function readOptionalValue(
  env: NodeJS.ProcessEnv,
  fileValues: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] || fileValues[key];
}

export function parseCodexDesktopAutomationArgs(
  argv: string[],
): CodexDesktopAutomationCliOptions {
  const options: CodexDesktopAutomationCliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--content" && next) {
      options.content = next;
      i += 1;
      continue;
    }

    if (arg === "--script-path" && next) {
      options.scriptPath = next;
      i += 1;
      continue;
    }

    if (arg === "--python" && next) {
      options.pythonCommand = next;
      i += 1;
    }
  }

  return options;
}

function resolveScriptPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) {
    throw new Error(`codex-desktop-automation script not found: ${resolved}`);
  }

  return resolved;
}

function resolveDefaultScriptPath(): string {
  const distSide = fileURLToPath(new URL("./skill_cli.py", import.meta.url));
  if (existsSync(distSide)) {
    return distSide;
  }

  const distDir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(distDir, "../../../../");
  const sourceSide = resolve(workspaceRoot, "src/example/codex-desktop-automation/skill_cli.py");
  if (existsSync(sourceSide)) {
    return sourceSide;
  }

  return distSide;
}

export async function runCodexDesktopAutomationCli(argv: string[]): Promise<void> {
  const options = parseCodexDesktopAutomationArgs(argv);
  const dotEnv = loadDotEnv();

  const content =
    options.content ||
    readOptionalValue(process.env, dotEnv, "CODEX_DESKTOP_AUTOMATION_CONTENT") ||
    `Codex desktop test ${new Date().toISOString()}`;
  const pythonCommand =
    options.pythonCommand ||
    readOptionalValue(process.env, dotEnv, "CODEX_DESKTOP_AUTOMATION_PYTHON") ||
    "python";
  const scriptPath = resolveScriptPath(
    options.scriptPath ||
      readOptionalValue(process.env, dotEnv, "CODEX_DESKTOP_AUTOMATION_SCRIPT_PATH") ||
      resolveDefaultScriptPath(),
  );

  const child = spawn(
    pythonCommand,
    [
      scriptPath,
      "--content",
      content,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(
      `codex-desktop-automation send failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
    );
  }

  process.stdout.write(stdout || "Sent message to Codex desktop\n");
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runCodexDesktopAutomationCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
