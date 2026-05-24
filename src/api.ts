import { randomBytes } from "node:crypto";
import type { GetUpdatesResp, SendMessageReq } from "./types.js";

function generateUin(): string {
  return randomBytes(4).toString("base64");
}

export class WeChatApi {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly uin: string;

  constructor(token: string, baseUrl: string) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.uin = generateUin();
  }

  headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.uin,
    };
  }

  private async postJson<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/${path}`, {
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

  async getUpdates(buf?: string, timeoutMs = 35_000): Promise<GetUpdatesResp> {
    const response = await this.postJson<GetUpdatesResp>(
      "ilink/bot/getupdates",
      buf ? { get_updates_buf: buf } : {},
      timeoutMs,
    );

    if (typeof response.ret === "number" && response.ret !== 0) {
      throw new Error(`getupdates failed with ret=${response.ret}${response.retmsg ? `, retmsg=${response.retmsg}` : ""}`);
    }

    return response;
  }

  async sendMessage(req: SendMessageReq, timeoutMs = 15_000): Promise<void> {
    const response = await this.postJson<{ ret?: number; retmsg?: string }>(
      "ilink/bot/sendmessage",
      req,
      timeoutMs,
    );

    if (typeof response.ret === "number" && response.ret !== 0) {
      throw new Error(`sendmessage failed with ret=${response.ret}${response.retmsg ? `, retmsg=${response.retmsg}` : ""}`);
    }
  }
}
