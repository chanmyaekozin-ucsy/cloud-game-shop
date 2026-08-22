import crypto from "crypto";

/**
 * WathanPay Backend Verification & Cryptographic Auth (Server-Side)
 * Official ledger verification & HMAC-SHA256 user authentication for Mini Apps & Merchants
 * according to SDK_INTEGRATION.md
 */

export interface MiniAppVerifiedUser {
  id: string;
  name: string;
  phone?: string;
  maskedPhone?: string;
  avatarUrl?: string | null;
}

export interface WathanPayAuthResult {
  ok: boolean;
  user?: MiniAppVerifiedUser;
  error?: string;
  authDate?: number;
}

/**
 * Cryptographically verifies WathanPay `authData` using the Merchant Secret Key (HMAC-SHA256).
 *
 * Algorithm:
 * 1. Parse URL-encoded query parameters.
 * 2. Extract and remove the `hash` parameter.
 * 3. Sort all remaining keys alphabetically.
 * 4. Construct check string: `key1=value1\nkey2=value2\n...`.
 * 5. Compute HMAC-SHA256 using Merchant Secret Key.
 * 6. Perform timing-safe constant-time equality check.
 * 7. Validate `auth_date` against `maxAgeSeconds` (default: 86400s / 24 hours).
 *
 * There is NO unsigned fallback: without a configured merchant secret this
 * always fails. Identity is never trusted from client-supplied fields.
 */
export function verifyWathanPayAuth(
  authDataString: string,
  maxAgeSeconds = 86400
): WathanPayAuthResult {
  const secret =
    process.env.WATHANPAY_MERCHANT_SECRET ||
    process.env.WATHANPAY_SECRET_KEY ||
    process.env.WATHANPAY_API_KEY;

  if (!secret) {
    return {
      ok: false,
      error: "WATHANPAY_MERCHANT_SECRET is not configured; WathanPay login is disabled.",
    };
  }

  if (!authDataString || typeof authDataString !== "string") {
    return { ok: false, error: "Missing authData" };
  }

  try {
    const params = new URLSearchParams(authDataString);
    const receivedHash = params.get("hash");
    if (!receivedHash) {
      return { ok: false, error: "Missing signature hash" };
    }

    params.delete("hash");

    // 1. Sort keys alphabetically
    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys
      .map((k) => `${k}=${params.get(k)}`)
      .join("\n");

    // 2. Calculate HMAC-SHA256 using Merchant Secret
    const calculatedHash = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    // 3. Constant-time comparison
    const calcBuf = Buffer.from(calculatedHash.toLowerCase(), "utf8");
    const recBuf = Buffer.from(receivedHash.toLowerCase(), "utf8");
    if (
      calcBuf.length !== recBuf.length ||
      !crypto.timingSafeEqual(calcBuf, recBuf)
    ) {
      return { ok: false, error: "Invalid cryptographic signature" };
    }

    // 4. Replay attack protection (timestamp check)
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (!(authDate > 0)) {
      return { ok: false, error: "Missing or invalid auth_date" };
    }
    if (Math.abs(now - authDate) > maxAgeSeconds) {
      return { ok: false, error: "Auth data expired" };
    }

    const id = params.get("id") || params.get("user_id") || "";
    if (!id) {
      return { ok: false, error: "Missing user ID in authData" };
    }

    const phone = params.get("phone") || params.get("maskedPhone") || undefined;

    return {
      ok: true,
      authDate,
      user: {
        id,
        name: params.get("name") || "WathanPay User",
        phone,
        maskedPhone: phone,
        avatarUrl: params.get("avatarUrl") || null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to verify authData",
    };
  }
}

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
 * X-API-Key: {YOUR_MERCHANT_SECRET_KEY}
 *
 * Without an API key this returns a hard failure in every environment -
 * payments are never auto-marked as succeeded by local code.
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
  const apiKey =
    process.env.WATHANPAY_MERCHANT_SECRET ||
    process.env.WATHANPAY_SECRET_KEY ||
    process.env.WATHANPAY_API_KEY;
  const baseUrl = (process.env.WATHANPAY_API_URL || "https://api.wathanpay.com").replace(/\/$/, "");

  if (!apiKey) {
    return {
      ok: false,
      verified: false,
      status: "not_configured",
      error: "WathanPay verification is not configured (WATHANPAY_MERCHANT_SECRET missing). Payment cannot be verified.",
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
