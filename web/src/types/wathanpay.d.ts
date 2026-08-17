export interface WathanPayPayParams {
  orderId: string;
  amount: number; // Amount in MMK (minimum 100 Ks)
  title?: string;
  subtitle?: string;
}

export interface WathanPayPayResult {
  ok: boolean;
  txid?: string; // 7-digit Transaction ID (e.g. '0000085')
  error?: string; // Failure reason if cancelled or rejected
  message?: string;
}

export interface WathanPaySDK {
  accessToken?: string;
  pay: (params: WathanPayPayParams) => Promise<WathanPayPayResult>;
  close: () => void;
}

declare global {
  interface Window {
    WathanPay?: WathanPaySDK;
  }
}
