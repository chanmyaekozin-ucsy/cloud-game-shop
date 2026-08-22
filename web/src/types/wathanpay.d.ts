export interface MiniAppUser {
  id?: string;
  name?: string;
  phone?: string;
  avatarUrl?: string | null;
}

export interface WathanPayPayParams {
  /** Unique Order ID in your system (e.g. ORD_12345) */
  orderId: string;

  /** Payment amount in Myanmar Kyats (>= 100 Ks) */
  amount?: number;

  /** Alias for amount in Myanmar Kyats */
  amountKs?: number;

  /** Product or item name displayed on the payment sheet */
  title?: string;

  /** Optional subtitle, player ID, server name, or item summary */
  subtitle?: string;

  /** Optional tracking request ID */
  requestId?: string;
}

export interface WathanPayPayResult {
  /** True if payment was authorized and settled on WathanPay ledger */
  ok: boolean;

  /** WathanPay 7-digit transaction ID (e.g. "0001048") */
  txid?: string;

  /** Error or cancellation message if ok is false */
  message?: string;

  /** Failure reason or error details */
  error?: string;

  /** Request ID matching the input */
  requestId?: string;
}

export type PayParams = WathanPayPayParams;
export type PayResult = WathanPayPayResult;

export interface WathanPaySDK {
  /** true when running inside the WathanPay native container */
  ready?: boolean;

  /** Logged-in user safe public profile */
  user?: MiniAppUser | null;

  /** Helper function returning the user profile */
  getUser?: () => MiniAppUser | null;

  /** Opens the native biometric / PIN bottom sheet for payment */
  pay: (
    params: WathanPayPayParams,
    callback?: (result: WathanPayPayResult) => void
  ) => Promise<WathanPayPayResult>;

  /** Closes the Mini App and returns to the WathanPay home screen */
  close?: () => void;

  /** Toggles immersive fullscreen mode */
  setFullScreen?: (enabled: boolean) => void;

  /** Sets viewport orientation for games/media */
  setOrientation?: (mode: "portrait" | "landscape" | "auto") => void;

  /** Switches app orientation to landscape mode */
  requestLandscape?: () => void;

  /** Switches app orientation to portrait mode */
  requestPortrait?: () => void;

  /** Optional / legacy access token */
  accessToken?: string;
}

declare global {
  interface Window {
    WathanPay?: WathanPaySDK;
  }

  interface WindowEventMap {
    WathanPayReady: Event;
    WathanPayBridgeReady: Event;
  }
}
