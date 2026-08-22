import crypto from "crypto";
import { dominateConfig } from "./shop-env";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type GatewayMethod = {
  id: string;
  method: "KBZPay" | "WavePay" | string;
  provider: "kbz" | "wave" | string;
  accountNumber: string;
  accountName: string;
};

export type GatewayDeposit = {
  id: string;
  status: "pending" | "paid" | "expired" | string;
  account_id?: string;
  provider?: string;
  amount_ks?: number;
  external_ref?: string;
  project_id?: string;
  created_at?: number;
  expires_at?: number;
  payee?: {
    display_name?: string;
    msisdn?: string;
  };
  qr_payload?: string | null;
  qr_png_base64?: string | null;
  matched_order_id?: string | null;
  paid_at?: number | null;
  trx_id?: string | null;
  bank_trx_id?: string | null;
  verify_reason?: string | null;
  submitted_last5?: string | null;
  error?: string | null;
};

function configured() {
  const { url, key } = dominateConfig();
  return Boolean(url && key);
}

export function gatewayConfigured() {
  return configured();
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = dominateConfig();
  if (!url || !key) {
    throw Object.assign(new Error("Dominate gateway is not configured."), { status: 503 });
  }

  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "X-API-Key": key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as T & {
    detail?: string;
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    const errorMsg = body.detail || body.message || body.error || `Gateway HTTP ${res.status}`;
    const err = Object.assign(new Error(errorMsg), {
      status: res.status,
      statusCode: res.status,
      isProviderBusy: res.status === 503,
    });
    throw err;
  }

  return body;
}

export async function listPaymentMethods(): Promise<GatewayMethod[]> {
  if (!configured()) return [];
  const data = await request<{ accounts?: Array<Record<string, unknown>> }>("/v1/payment-methods");
  const out: GatewayMethod[] = [];

  for (const acct of data.accounts || []) {
    const rawMethod = String(acct.method || acct.provider || "").toLowerCase().trim();
    const rawProvider = String(acct.provider || "").toLowerCase().trim();

    let method: "KBZPay" | "WavePay" | "" = "";
    let provider: "kbz" | "wave" = "kbz";

    if (rawMethod.includes("kbz") || rawProvider.includes("kbz")) {
      method = "KBZPay";
      provider = "kbz";
    } else if (rawMethod.includes("wave") || rawProvider.includes("wave")) {
      method = "WavePay";
      provider = "wave";
    }

    if (!method) continue;

    out.push({
      id: String(acct.id || ""),
      method,
      provider,
      accountNumber: String(acct.msisdn || "").trim(),
      accountName: String(acct.display_name || "").trim(),
    });
  }

  return out.filter((m) => m.id);
}

export function createDeposit(input: {
  accountId: string;
  amountKs: number;
  orderId: string;
  callbackUrl?: string;
}) {
  return request<GatewayDeposit>("/v1/deposits", {
    method: "POST",
    body: JSON.stringify({
      account_id: input.accountId,
      amount_ks: input.amountKs,
      external_ref: input.orderId.startsWith("cgs-") ? input.orderId : `cgs-web-${input.orderId}`,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    }),
  });
}

export function verifyDepositLast5(depositId: string, last5: string) {
  return request<GatewayDeposit>(`/v1/deposits/${encodeURIComponent(depositId)}/verify`, {
    method: "POST",
    body: JSON.stringify({ last5 }),
  });
}

export function getDeposit(depositId: string) {
  return request<GatewayDeposit>(`/v1/deposits/${encodeURIComponent(depositId)}`, {
    method: "GET",
  });
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret?: string): boolean {
  const webhookSecret = secret || dominateConfig().webhookSecret || dominateConfig().key;
  if (!webhookSecret || !signature) return false;

  try {
    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
    const sigBuffer = Buffer.from(signature.toLowerCase().trim(), "utf8");
    const expectedBuffer = Buffer.from(expected.toLowerCase().trim(), "utf8");

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function paidStatus(status: string) {
  return ["paid", "succeeded", "success", "completed"].includes((status || "").toLowerCase());
}

export function failedStatus(status: string) {
  return ["failed", "expired", "cancelled", "canceled", "rejected"].includes((status || "").toLowerCase());
}
