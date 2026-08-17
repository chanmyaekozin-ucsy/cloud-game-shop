import type { WathanPayPayParams, WathanPayPayResult, WathanPaySDK } from "@/types/wathanpay";

export const WathanPay: WathanPaySDK = {
  get accessToken() {
    if (typeof window === "undefined") return undefined;
    return window.WathanPay?.accessToken;
  },

  async pay(params: WathanPayPayParams): Promise<WathanPayPayResult> {
    if (typeof window === "undefined") {
      return { ok: false, error: "Window is not defined" };
    }

    if (!window.WathanPay?.pay) {
      return {
        ok: false,
        error: "WathanPay SDK is not available. Please open inside the WathanPay app or ensure sdk.js is loaded.",
      };
    }

    try {
      return await window.WathanPay.pay(params);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Payment failed unexpectedly",
      };
    }
  },

  close() {
    if (typeof window !== "undefined" && window.WathanPay?.close) {
      window.WathanPay.close();
    }
  },
};

export type { WathanPayPayParams, WathanPayPayResult };
