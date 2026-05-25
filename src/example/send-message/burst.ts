import process from "node:process";
import { Agent, request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import {
  buildSendTextRequest,
  ClawbotApiError,
  ClawbotClient,
  sendTextMessage,
  type SendMessageReq,
  type SendMessageResp,
} from "../../sdk/index.js";
import { loadLatestAccount } from "../shared/account-store.js";
import { loadConversationState } from "../shared/conversation-state-store.js";
import { loadConfig } from "../shared/config.js";
import { resolveLatestSessionTarget } from "../shared/session-target-resolver.js";

type BurstMode = "client-reuse" | "keep-alive";

export interface BurstOptions {
  count: number;
  intervalMs: number;
  textPrefix: string;
  mode: BurstMode;
  to?: string;
  context?: string;
}

export function parseBurstArgs(argv: string[]): BurstOptions {
  const options: BurstOptions = {
    count: 20,
    intervalMs: 1000,
    textPrefix: "burst",
    mode: "client-reuse",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--count" && next) {
      options.count = Number(next);
      i += 1;
      continue;
    }

    if (arg === "--interval-ms" && next) {
      options.intervalMs = Number(next);
      i += 1;
      continue;
    }

    if (arg === "--text-prefix" && next) {
      options.textPrefix = next;
      i += 1;
      continue;
    }

    if (arg === "--mode" && next) {
      if (next === "client-reuse" || next === "keep-alive") {
        options.mode = next;
      } else {
        throw new Error("Invalid --mode. Expected client-reuse or keep-alive.");
      }
      i += 1;
      continue;
    }

    if (arg === "--to" && next) {
      options.to = next;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildRequestBody(client: ClawbotClient, req: SendMessageReq): string {
  return JSON.stringify({
    ...req,
    base_info: client.baseInfo(),
  });
}

function sendMessageKeepAlive(
  baseUrl: string,
  headers: Record<string, string>,
  body: string,
  agent: Agent,
  timeoutMs = 15_000,
): Promise<SendMessageResp> {
  return new Promise((resolve, reject) => {
    const url = new URL("/ilink/bot/sendmessage", `${baseUrl.replace(/\/+$/, "")}/`);
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${rawText}`));
            return;
          }

          try {
            resolve(JSON.parse(rawText) as SendMessageResp);
          } catch (error) {
            reject(
              new Error(
                `Invalid JSON response: ${error instanceof Error ? error.message : String(error)}; body=${rawText}`,
              ),
            );
          }
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function runBurstCli(argv: string[]): Promise<void> {
  const options = parseBurstArgs(argv);
  if (!Number.isFinite(options.count) || options.count <= 0) {
    throw new Error("Invalid --count. Expected a positive number.");
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) {
    throw new Error("Invalid --interval-ms. Expected a non-negative number.");
  }

  const config = loadConfig();
  const account = loadLatestAccount();
  if (!account) {
    throw new Error("No bound account found. Run `node dist/src/example/send-message/cli.js setup` first.");
  }

  const client = new ClawbotClient(account.botToken, account.baseUrl || config.baseUrl);
  const target = options.to
    ? {
        toUserId: options.to,
        contextToken: options.context ?? config.contextToken,
        source: "stored" as const,
      }
    : await resolveLatestSessionTarget(client);
  const keepAliveAgent = options.mode === "keep-alive"
    ? new Agent({
        keepAlive: true,
        maxSockets: 1,
      })
    : undefined;

  for (let i = 1; i <= options.count; i += 1) {
    const text = `${options.textPrefix} ${i}/${options.count} ${new Date().toISOString()}`;
    const startedAt = Date.now();
    const req = buildSendTextRequest({
      fromUserId: account.accountId,
      toUserId: target.toUserId,
      contextToken: target.contextToken,
      text,
    });

    try {
      if (options.mode === "keep-alive") {
        const keepAliveHeaders = {
          ...client.headers(),
          "Content-Length": String(Buffer.byteLength(buildRequestBody(client, req), "utf8")),
          Connection: "keep-alive",
        };
        const response = await sendMessageKeepAlive(
          account.baseUrl || config.baseUrl,
          keepAliveHeaders,
          buildRequestBody(client, req),
          keepAliveAgent!,
        );
        if ((typeof response.errcode === "number" && response.errcode !== 0) || (typeof response.ret === "number" && response.ret !== 0)) {
          throw new ClawbotApiError("sendmessage", response, `sendmessage raw failure ${JSON.stringify(response)}`);
        }
      } else {
        await sendTextMessage(client, {
          fromUserId: account.accountId,
          toUserId: target.toUserId,
          contextToken: target.contextToken,
          text,
        });
      }

      process.stdout.write(
        `[${i}/${options.count}] ok ${Date.now() - startedAt}ms ${text}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[${i}/${options.count}] failed ${Date.now() - startedAt}ms ${message}\n`,
      );
      if (error instanceof ClawbotApiError) {
        process.stderr.write(`[${i}/${options.count}] raw ${JSON.stringify(error.response)}\n`);
      }

      throw error;
    }

    if (i < options.count && options.intervalMs > 0) {
      await sleep(options.intervalMs);
    }
  }

  const state = loadConversationState();
  keepAliveAgent?.destroy();
  process.stdout.write(
    `Completed burst (${options.mode}) to ${target.toUserId}${state.lastMessageText ? ` (last inbound: ${state.lastMessageText})` : ""}\n`,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectRun) {
  runBurstCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
