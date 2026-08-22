/**
 * WathanPay Backend Verification (Server-Side)
 * Official ledger verification for Mini Apps & Merchants according to SDK_INTEGRATION.md
 */

export type VerifyPaymentParams = {
  shopOrderId: string;
  transactionId?: string;
  expectedAmountKs?: number;
};

export type VerifyPaymentResult = {
  ok: boolean;
  verified: boolean;
  status: "succeeded" | "failed" | "pending" | string;
  transactionId?: string;
  shopOrderId?: string;
  amountKs?: number;
  paidAt?: string;
  createdAt?: string;
  error?: string;
  message?: string;
};

/**
 * Verifies a shop order payment with the official WathanPay Core Ledger.
 *
 * Endpoint:
 * GET https://api.wathanpay.com/v1/merchant/verify-payment?shopOrderId={shopOrderId}&transactionId={transactionId}
 * Headers:
 * X-API-Key: {YOUR_MERCHANT_API_KEY}
 */
export async function verifyWathanPayPayment(
  shopOrderIdOrParams: string | VerifyPaymentParams,
  legacyExpectedAmountKs?: number
): Promise<VerifyPaymentResult> {
  const params: VerifyPaymentParams =
    typeof shopOrderIdOrParams === "string"
      ? {
          shopOrderId: shopOrderIdOrParams,
          expectedAmountKs: legacyExpectedAmountKs,
        }
      : shopOrderIdOrParams;

  const { shopOrderId, transactionId, expectedAmountKs } = params;
  const apiKey = process.env.WATHANPAY_API_KEY;
  const baseUrl = (process.env.WATHANPAY_API_URL || "https://api.wathanpay.com").replace(/\/$/, "");

  // If no merchant API key is configured (e.g. local development or demo environment)
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        verified: false,
        status: "failed",
        error: "WATHANPAY_API_KEY is not configured on production server.",
      };
    }
    return {
      ok: true,
      verified: true,
      status: "succeeded",
      shopOrderId,
      amountKs: expectedAmountKs,
      transactionId: transactionId || `WP_DEMO_${Date.now().toString(36)}`,
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  try {
    const searchParams = new URLSearchParams();
    if (shopOrderId) searchParams.set("shopOrderId", shopOrderId);
    if (transactionId) searchParams.set("transactionId", transactionId);
    if (expectedAmountKs !== undefined) searchParams.set("amountKs", String(expectedAmountKs));

    const url = `${baseUrl}/v1/merchant/verify-payment?${searchParams.toString()}`;
    let res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    });

    // Fallback for backward compatibility if /v1/merchant/verify-payment returns 404
    if (res.status === 404) {
      const legacyUrl = `${baseUrl}/v1/mini-apps/verify-payment?shopOrderId=${encodeURIComponent(shopOrderId)}`;
      res = await fetch(legacyUrl, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });
    }

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      verified?: boolean;
      status?: string;
      transactionId?: string;
      shopOrderId?: string;
      amountKs?: number;
      paidAt?: string;
      createdAt?: string;
      error?: string;
      message?: string;
    };

    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        error: data.error || data.message || `Verification failed with status ${res.status}`,
        message: data.message || data.error,
      };
    }

    if (data.status !== "succeeded" || data.verified === false) {
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        error: data.message || data.error || `Order payment status is ${data.status}`,
        message: data.message,
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
      paidAt: data.paidAt || data.createdAt || new Date().toISOString(),
      createdAt: data.createdAt || data.paidAt || new Date().toISOString(),
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
