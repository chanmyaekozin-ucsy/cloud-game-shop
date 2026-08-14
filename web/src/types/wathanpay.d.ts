export {};

declare global {
  interface Window {
    WathanPay?: {
      accessToken?: string;
      close?: () => void;
      pay?: (input: {
        orderId: string;
        amountKs: number;
        title?: string;
        subtitle?: string;
      }) => Promise<{ ok?: boolean; txid?: string; message?: string }>;
    };
  }
}
