import { randomBytes } from "node:crypto";
import type {
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  NotifyStartResp,
  NotifyStopResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  SendTypingResp,
} from "./types.js";

function generateUin(): string {
  return randomBytes(4).toString("base64");
}

export interface ClawbotClientOptions {
  botAgent?: string;
  channelVersion?: string;
  fetchImpl?: typeof fetch;
}

export class ClawbotApiError extends Error {
  readonly path: string;
  readonly response: { ret?: number; errcode?: number; errmsg?: string; retmsg?: string };

  constructor(
    path: string,
    response: { ret?: number; errcode?: number; errmsg?: string; retmsg?: string },
    message: string,
  ) {
    super(message);
    this.name = "ClawbotApiError";
    this.path = path;
    this.response = response;
  }
}

export class ClawbotClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly uin: string;
  private readonly botAgent?: string;
  private readonly channelVersion?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, baseUrl: string, options: ClawbotClientOptions = {}) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.uin = generateUin();
    this.botAgent = options.botAgent;
    this.channelVersion = options.channelVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.uin,
    };
  }

  baseInfo(): { bot_agent?: string; channel_version?: string } {
    return {
      bot_agent: this.botAgent,
      channel_version: this.channelVersion,
    };
  }

  private async postJson<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private ensureSuccess(path: string, response: { ret?: number; errcode?: number; errmsg?: string; retmsg?: string }): void {
    const hasErrcodeFailure = typeof response.errcode === "number" && response.errcode !== 0;
    const hasRetFailure = typeof response.ret === "number" && response.ret !== 0;
    if (hasErrcodeFailure || hasRetFailure) {
      const codeLabel = hasErrcodeFailure ? "errcode" : "ret";
      const codeValue = hasErrcodeFailure ? response.errcode : response.ret;
      const messageLabel = hasErrcodeFailure ? "errmsg" : response.retmsg ? "retmsg" : "errmsg";
      const messageValue = hasErrcodeFailure
        ? response.errmsg || response.retmsg
        : response.retmsg || response.errmsg;
      throw new ClawbotApiError(
        path,
        response,
        `${path} failed with ${codeLabel}=${codeValue}${messageValue ? `, ${messageLabel}=${messageValue}` : ""}`,
      );
    }
  }

  async getUpdates(buf?: string, timeoutMs = 35_000): Promise<GetUpdatesResp> {
    const request: GetUpdatesReq & { base_info?: { bot_agent?: string; channel_version?: string } } = {
      get_updates_buf: buf ?? "",
      base_info: this.baseInfo(),
    };

    const response = await this.postJson<GetUpdatesResp>(
      "ilink/bot/getupdates",
      request,
      timeoutMs,
    );
    this.ensureSuccess("getupdates", response);
    return response;
  }

  async sendMessage(req: SendMessageReq, timeoutMs = 15_000): Promise<SendMessageResp> {
    const response = await this.sendMessageRaw(req, timeoutMs);
    this.ensureSuccess("sendmessage", response);
    return response;
  }

  async sendMessageRaw(req: SendMessageReq, timeoutMs = 15_000): Promise<SendMessageResp> {
    return this.postJson<SendMessageResp>(
      "ilink/bot/sendmessage",
      { ...req, base_info: this.baseInfo() },
      timeoutMs,
    );
  }

  async getUploadUrl(req: GetUploadUrlReq, timeoutMs = 15_000): Promise<GetUploadUrlResp> {
    const response = await this.postJson<GetUploadUrlResp>(
      "ilink/bot/getuploadurl",
      { ...req, base_info: this.baseInfo() },
      timeoutMs,
    );
    this.ensureSuccess("getuploadurl", response);
    return response;
  }

  async getConfig(ilinkUserId: string, contextToken?: string, timeoutMs = 10_000): Promise<GetConfigResp> {
    const response = await this.postJson<GetConfigResp>(
      "ilink/bot/getconfig",
      {
        ilink_user_id: ilinkUserId,
        context_token: contextToken,
        base_info: this.baseInfo(),
      },
      timeoutMs,
    );
    this.ensureSuccess("getconfig", response);
    return response;
  }

  async sendTyping(req: SendTypingReq, timeoutMs = 10_000): Promise<SendTypingResp> {
    const response = await this.postJson<SendTypingResp>(
      "ilink/bot/sendtyping",
      { ...req, base_info: this.baseInfo() },
      timeoutMs,
    );
    this.ensureSuccess("sendtyping", response);
    return response;
  }

  async notifyStart(timeoutMs = 10_000): Promise<NotifyStartResp> {
    const response = await this.postJson<NotifyStartResp>(
      "ilink/bot/msg/notifystart",
      { base_info: this.baseInfo() },
      timeoutMs,
    );
    this.ensureSuccess("notifystart", response);
    return response;
  }

  async notifyStop(timeoutMs = 10_000): Promise<NotifyStopResp> {
    const response = await this.postJson<NotifyStopResp>(
      "ilink/bot/msg/notifystop",
      { base_info: this.baseInfo() },
      timeoutMs,
    );
    this.ensureSuccess("notifystop", response);
    return response;
  }
}
