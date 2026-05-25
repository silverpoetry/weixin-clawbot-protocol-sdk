import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDotEnv } from "../shared/config.js";

export interface WechatAutomationCliOptions {
  to?: string;
  content?: string;
  action: "sendtext" | "sendpic";
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

export function parseWechatAutomationArgs(argv: string[]): WechatAutomationCliOptions {
  const options: WechatAutomationCliOptions = {
    action: "sendtext",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--to" && next) {
      options.to = next;
      i += 1;
      continue;
    }

    if (arg === "--content" && next) {
      options.content = next;
      i += 1;
      continue;
    }

    if (arg === "--action" && next) {
      if (next === "sendtext" || next === "sendpic") {
        options.action = next;
      } else {
        throw new Error("Invalid --action. Expected sendtext or sendpic.");
      }
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
    throw new Error(`wechat-automation script not found: ${resolved}`);
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
  const sourceSide = resolve(workspaceRoot, "src/example/wechat-automation/skill_cli.py");
  if (existsSync(sourceSide)) {
    return sourceSide;
  }

  return distSide;
}

export async function runWechatAutomationCli(argv: string[]): Promise<void> {
  const options = parseWechatAutomationArgs(argv);
  const dotEnv = loadDotEnv();

  const to =
    options.to || readOptionalValue(process.env, dotEnv, "WECHAT_AUTOMATION_TO");
  const content =
    options.content ||
    readOptionalValue(process.env, dotEnv, "WECHAT_AUTOMATION_CONTENT") ||
    `ClawBot test ${new Date().toISOString()}`;
  const pythonCommand =
    options.pythonCommand ||
    readOptionalValue(process.env, dotEnv, "WECHAT_AUTOMATION_PYTHON") ||
    "python";
  const scriptPath = resolveScriptPath(
    options.scriptPath ||
      readOptionalValue(process.env, dotEnv, "WECHAT_AUTOMATION_SCRIPT_PATH") ||
      resolveDefaultScriptPath(),
  );

  if (!to) {
    throw new Error("Missing WeChat target contact. Pass --to or set WECHAT_AUTOMATION_TO.");
  }

  const child = spawn(
    pythonCommand,
    [
      scriptPath,
      "--to",
      to,
      "--content",
      content,
      "--action",
      options.action,
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
      `wechat-automation send failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
    );
  }

  process.stdout.write(stdout || `Sent ${options.action} to ${to}\n`);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runWechatAutomationCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
