/**
 * WathanPay wallet charge.
 * When WATHANPAY_API_URL is set, debit the player's WathanPay balance.
 * Until then, Cloud Game Shop uses the local demo wallet.
 */
export type ChargeInput = {
  accessToken?: string;
  amountKs: number;
  orderId: string;
  last5: string;
};

export type ChargeResult = {
  ok: boolean;
  txid: string;
  message: string;
};

export async function chargeWathanPay(input: ChargeInput): Promise<ChargeResult | null> {
  const base = (process.env.WATHANPAY_API_URL || "").replace(/\/$/, "");
  if (!base || !input.accessToken) return null;

  const res = await fetch(`${base}/v1/mini-apps/charge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amountKs: input.amountKs,
      orderId: input.orderId,
      last5: input.last5,
      merchant: "cloud-game-shop",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    txid?: string;
    id?: string;
    message?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      txid: "",
      message: body.error?.message || body.message || "WathanPay payment failed",
    };
  }
  return {
    ok: body.ok !== false,
    txid: String(body.txid || body.id || ""),
    message: body.message || "Paid with WathanPay",
  };
}
