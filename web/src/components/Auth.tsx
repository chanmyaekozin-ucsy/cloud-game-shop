"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { MiniAppUser } from "@/types/wathanpay";

export type Me = {
  id: string;
  name: string;
  role: "user" | "admin";
  phone?: string;
  email?: string;
  balanceKs: number;
  miniApp?: boolean;
  avatarUrl?: string | null;
};

const AuthContext = createContext<{
  me: Me | null;
  ready: boolean;
  miniApp: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  me: null,
  ready: false,
  miniApp: false,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [miniApp, setMiniApp] = useState(false);

  const refresh = useCallback(async () => {
    const data = await api<{ user: Me | null }>("/api/auth/me");
    setMe(data.user);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function syncWathanPayUser() {
      if (typeof window === "undefined") return;

      const isWP = Boolean(
        window.WathanPay?.ready ||
        window.WathanPay?.user ||
        window.WathanPay?.authData ||
        window.WathanPay?.accessToken ||
        window.WathanPay?.pay
      );

      if (isWP) {
        setMiniApp(true);
        document.documentElement.dataset.miniApp = "true";

        const user: MiniAppUser | null =
          window.WathanPay?.user ||
          (typeof window.WathanPay?.getUser === "function"
            ? window.WathanPay.getUser()
            : null);
        const authData =
          window.WathanPay?.authData ||
          (typeof window.WathanPay?.getAuthData === "function"
            ? window.WathanPay.getAuthData()
            : "");
        const token = window.WathanPay?.accessToken;

        if (authData || user || token) {
          try {
            const data = await api<{ user: Me }>("/api/auth/wathanpay", {
              method: "POST",
              body: JSON.stringify({ authData, user, accessToken: token }),
            });
            if (mounted) {
              setMe(data.user);
              setReady(true);
            }
            return;
          } catch {
            // Fallback to cookie check if WathanPay auth route fails
          }
        }
      }

      try {
        const data = await api<{ user: Me | null }>("/api/auth/me");
        if (mounted) {
          setMe(data.user);
        }
      } catch {
        if (mounted) {
          setMe(null);
        }
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    }

    void syncWathanPayUser();

    function onBridgeReady() {
      void syncWathanPayUser();
    }

    window.addEventListener("WathanPayReady", onBridgeReady);
    window.addEventListener("WathanPayBridgeReady", onBridgeReady);

    return () => {
      mounted = false;
      window.removeEventListener("WathanPayReady", onBridgeReady);
      window.removeEventListener("WathanPayBridgeReady", onBridgeReady);
    };
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
    if (typeof window.WathanPay?.close === "function") {
      window.WathanPay.close();
    }
  };

  return (
    <AuthContext.Provider value={{ me, ready, miniApp, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
