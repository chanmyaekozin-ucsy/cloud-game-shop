/**
 * WathanPay Backend Verification (Server-Side)
 * Official ledger verification for Mini Apps according to SDK_INTEGRATION.md
 */

export type VerifyPaymentResult = {
  ok: boolean;
  verified: boolean;
  status: "succeeded" | "failed" | "pending" | string;
  transactionId?: string;
  shopOrderId?: string;
  amountKs?: number;
  paidAt?: string;
  error?: string;
};

/**
 * Verifies a shop order payment with the official WathanPay ledger.
 *
 * Endpoint:
 * GET https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId={shopOrderId}
 * X-API-Key: {YOUR_MERCHANT_API_KEY}
 */
export async function verifyWathanPayPayment(
  shopOrderId: string,
  expectedAmountKs?: number
): Promise<VerifyPaymentResult> {
  const apiKey = process.env.WATHANPAY_API_KEY;
  const baseUrl = (process.env.WATHANPAY_API_URL || "https://api.wathanpay.com").replace(/\/$/, "");

  // If no merchant API key is configured (e.g. local development or demo environment)
  if (!apiKey) {
    return {
      ok: true,
      verified: false,
      status: "succeeded",
      shopOrderId,
      amountKs: expectedAmountKs,
      transactionId: `WP_DEMO_${Date.now().toString(36)}`,
      paidAt: new Date().toISOString(),
    };
  }

  try {
    const url = `${baseUrl}/v1/mini-apps/verify-payment?shopOrderId=${encodeURIComponent(shopOrderId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
      },
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      verified?: boolean;
      status?: string;
      transactionId?: string;
      shopOrderId?: string;
      amountKs?: number;
      paidAt?: string;
      error?: string;
      message?: string;
    };

    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        error: data.error || data.message || `Verification failed with status ${res.status}`,
      };
    }

    if (data.status !== "succeeded") {
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        error: `Order payment status is ${data.status}`,
      };
    }

    if (
      expectedAmountKs !== undefined &&
      data.amountKs !== undefined &&
      Number(data.amountKs) !== Number(expectedAmountKs)
    ) {
      return {
        ok: false,
        verified: false,
        status: "amount_mismatch",
        error: `Expected ${expectedAmountKs} Ks, but ledger recorded ${data.amountKs} Ks`,
      };
    }

    return {
      ok: true,
      verified: true,
      status: "succeeded",
      transactionId: data.transactionId,
      shopOrderId: data.shopOrderId || shopOrderId,
      amountKs: data.amountKs,
      paidAt: data.paidAt || new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      status: "network_error",
      error: err instanceof Error ? err.message : "Failed to reach WathanPay verification server",
    };
  }
}
