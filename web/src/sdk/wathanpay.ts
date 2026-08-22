import type {
  MiniAppUser,
  WathanPayPayParams,
  WathanPayPayResult,
  WathanPaySDK,
} from "@/types/wathanpay";

export const WathanPay: WathanPaySDK = {
  get ready() {
    if (typeof window === "undefined") return false;
    return Boolean(window.WathanPay?.ready);
  },

  get user(): MiniAppUser | null {
    if (typeof window === "undefined") return null;
    return (
      window.WathanPay?.user ||
      (typeof window.WathanPay?.getUser === "function"
        ? window.WathanPay.getUser()
        : null) ||
      null
    );
  },

  getUser(): MiniAppUser | null {
    return this.user ?? null;
  },

  get authData(): string {
    if (typeof window === "undefined") return "";
    return (
      window.WathanPay?.authData ||
      (typeof window.WathanPay?.getAuthData === "function"
        ? window.WathanPay.getAuthData()
        : "") ||
      ""
    );
  },

  getAuthData(): string {
    return this.authData || "";
  },

  get accessToken() {
    if (typeof window === "undefined") return undefined;
    return window.WathanPay?.accessToken;
  },

  async pay(params: WathanPayPayParams): Promise<WathanPayPayResult> {
    if (typeof window === "undefined") {
      return { ok: false, error: "Window is not defined", message: "Window is not defined" };
    }

    if (!window.WathanPay?.pay) {
      return {
        ok: false,
        error:
          "WathanPay SDK is not available. Please open inside the WathanPay app or ensure sdk.js is loaded.",
        message:
          "WathanPay SDK is not available. Please open inside the WathanPay app or ensure sdk.js is loaded.",
      };
    }

    try {
      const normalizedParams: WathanPayPayParams = {
        orderId: params.orderId,
        amount: params.amount ?? params.amountKs ?? 0,
        amountKs: params.amountKs ?? params.amount ?? 0,
        title: params.title,
        subtitle: params.subtitle,
        requestId: params.requestId,
        publishableKey:
          params.publishableKey ||
          process.env.NEXT_PUBLIC_WATHANPAY_PUBLISHABLE_KEY ||
          undefined,
      };
      return await window.WathanPay.pay(normalizedParams);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Payment failed unexpectedly";
      return {
        ok: false,
        error: errorMsg,
        message: errorMsg,
      };
    }
  },

  close() {
    if (typeof window !== "undefined" && typeof window.WathanPay?.close === "function") {
      window.WathanPay.close();
    }
  },

  setFullScreen(enabled: boolean) {
    if (typeof window !== "undefined" && typeof window.WathanPay?.setFullScreen === "function") {
      window.WathanPay.setFullScreen(enabled);
    }
  },

  setOrientation(mode: "portrait" | "landscape" | "auto") {
    if (typeof window !== "undefined" && typeof window.WathanPay?.setOrientation === "function") {
      window.WathanPay.setOrientation(mode);
    }
  },

  requestLandscape() {
    if (typeof window !== "undefined" && typeof window.WathanPay?.requestLandscape === "function") {
      window.WathanPay.requestLandscape();
    }
  },

  requestPortrait() {
    if (typeof window !== "undefined" && typeof window.WathanPay?.requestPortrait === "function") {
      window.WathanPay.requestPortrait();
    }
  },
};

export type { MiniAppUser, WathanPayPayParams, WathanPayPayResult };
