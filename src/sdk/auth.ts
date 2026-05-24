import { DEFAULT_BASE_URL } from "../shared/constants.js";

export interface LoginAccount {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId: string;
  createdAt: string;
}

interface QrCodeResponse {
  ret: number;
  qrcode?: string;
  qrcode_img_content?: string;
}

interface QrStatusResponse {
  ret: number;
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

const QR_CODE_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
const QR_STATUS_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status`;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startQrLogin(): Promise<{ qrcodeUrl: string; qrcodeId: string }> {
  const response = await fetch(QR_CODE_URL);
  if (!response.ok) {
    throw new Error(`Failed to get QR code: HTTP ${response.status}`);
  }

  const data = (await response.json()) as QrCodeResponse;
  if (data.ret !== 0 || !data.qrcode || !data.qrcode_img_content) {
    throw new Error(`Failed to get QR code (ret=${data.ret})`);
  }

  return {
    qrcodeUrl: data.qrcode_img_content,
    qrcodeId: data.qrcode,
  };
}

export async function waitForQrScan(
  qrcodeId: string,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<LoginAccount> {
  while (true) {
    const response = await fetch(`${QR_STATUS_URL}?qrcode=${encodeURIComponent(qrcodeId)}`);
    if (!response.ok) {
      throw new Error(`Failed to check QR status: HTTP ${response.status}`);
    }

    const data = (await response.json()) as QrStatusResponse;
    switch (data.status) {
      case "wait":
      case "scaned":
        await sleep(pollIntervalMs);
        continue;
      case "confirmed":
        if (!data.bot_token || !data.ilink_bot_id || !data.ilink_user_id) {
          throw new Error("QR confirmed but missing required fields in response");
        }
        return {
          botToken: data.bot_token,
          accountId: data.ilink_bot_id,
          baseUrl: data.baseurl || DEFAULT_BASE_URL,
          userId: data.ilink_user_id,
          createdAt: new Date().toISOString(),
        };
      case "expired":
        throw new Error("QR code expired");
      default:
        await sleep(pollIntervalMs);
    }
  }
}
