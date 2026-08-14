import { dominateConfig } from "./shop-env";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type GatewayMethod = {
  id: string;
  method: string;
  provider: string;
  accountNumber: string;
  accountName: string;
};

export type GatewayDeposit = {
  id: string;
  status: string;
  payee?: { display_name?: string; msisdn?: string };
  trx_id?: string | null;
  bank_trx_id?: string | null;
  verify_reason?: string | null;
};

function configured() {
  const { url, key } = dominateConfig();
  return Boolean(url && key);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = dominateConfig();
  if (!url || !key) {
    throw Object.assign(new Error("Dominate gateway is not configured."), { status: 503 });
  }
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
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
    throw Object.assign(
      new Error(body.detail || body.message || body.error || `Gateway HTTP ${res.status}`),
      { status: res.status >= 500 ? 502 : res.status },
    );
  }
  return body;
}

export function gatewayConfigured() {
  return configured();
}

export async function listPaymentMethods(): Promise<GatewayMethod[]> {
  if (!configured()) return [];
  const data = await request<{ accounts?: Array<Record<string, unknown>> }>("/v1/payment-methods");
  const out: GatewayMethod[] = [];
  for (const acct of data.accounts || []) {
    const method = String(acct.method || "").trim();
    if (method !== "KBZPay" && method !== "WavePay") continue;
    out.push({
      id: String(acct.id || ""),
      method,
      provider: String(acct.provider || ""),
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
}) {
  return request<GatewayDeposit>("/v1/deposits", {
    method: "POST",
    body: JSON.stringify({
      account_id: input.accountId,
      amount_ks: input.amountKs,
      external_ref: `cgs-web-${input.orderId}`,
    }),
  });
}

export function verifyDepositLast5(depositId: string, last5: string) {
  return request<GatewayDeposit>(`/v1/deposits/${encodeURIComponent(depositId)}/verify`, {
    method: "POST",
    body: JSON.stringify({ last5 }),
  });
}

export function paidStatus(status: string) {
  return ["paid", "succeeded", "success", "completed"].includes(status.toLowerCase());
}

export function failedStatus(status: string) {
  return ["failed", "expired", "cancelled", "canceled", "rejected"].includes(status.toLowerCase());
}
