"use client";

import { useEffect, useState, useCallback } from "react";
import type { MiniAppUser, PayParams, PayResult } from "@/types/wathanpay";

export interface PayOptions {
  orderId: string;
  amount?: number;
  amountKs?: number;
  title?: string;
  subtitle?: string;
  requestId?: string;
}

export type { MiniAppUser, PayResult };

export function useWathanPay() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [authData, setAuthData] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    function checkBridge() {
      if (window.WathanPay?.ready || window.WathanPay?.pay) {
        setIsReady(true);
        const currentUser =
          window.WathanPay.user ||
          (typeof window.WathanPay.getUser === "function"
            ? window.WathanPay.getUser()
            : null);
        setUser(currentUser || null);
        const currentAuthData =
          window.WathanPay.authData ||
          (typeof window.WathanPay.getAuthData === "function"
            ? window.WathanPay.getAuthData()
            : "");
        setAuthData(currentAuthData || "");
      }
    }

    checkBridge();
    window.addEventListener("WathanPayReady", checkBridge);
    window.addEventListener("WathanPayBridgeReady", checkBridge);

    return () => {
      window.removeEventListener("WathanPayReady", checkBridge);
      window.removeEventListener("WathanPayBridgeReady", checkBridge);
    };
  }, []);

  const pay = useCallback(
    async (options: PayOptions | PayParams): Promise<PayResult> => {
      if (!window.WathanPay?.pay) {
        return {
          ok: false,
          error: "WathanPay SDK not available in this browser",
          message: "WathanPay SDK not available in this browser",
        };
      }
      return window.WathanPay.pay({
        orderId: options.orderId,
        amount: options.amount ?? options.amountKs ?? 0,
        amountKs: options.amountKs ?? options.amount ?? 0,
        title: options.title,
        subtitle: options.subtitle,
        requestId: options.requestId,
      });
    },
    []
  );

  const close = useCallback(() => {
    window.WathanPay?.close?.();
  }, []);

  const setFullScreen = useCallback((enabled: boolean) => {
    window.WathanPay?.setFullScreen?.(enabled);
  }, []);

  const setOrientation = useCallback((mode: "portrait" | "landscape" | "auto") => {
    window.WathanPay?.setOrientation?.(mode);
  }, []);

  const requestLandscape = useCallback(() => {
    window.WathanPay?.requestLandscape?.();
  }, []);

  const requestPortrait = useCallback(() => {
    window.WathanPay?.requestPortrait?.();
  }, []);

  return {
    isInsideApp: isReady,
    isReady,
    user,
    authData,
    pay,
    close,
    setFullScreen,
    setOrientation,
    requestLandscape,
    requestPortrait,
  };
}
