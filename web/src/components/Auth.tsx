"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

export type Me = {
  id: string;
  name: string;
  role: "user" | "admin";
  phone?: string;
  email?: string;
  balanceKs: number;
  miniApp?: boolean;
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

  const refresh = async () => {
    const data = await api<{ user: Me | null }>("/api/auth/me");
    setMe(data.user);
  };

  useEffect(() => {
    const token = window.WathanPay?.accessToken;
    if (token) {
      setMiniApp(true);
      document.documentElement.dataset.miniApp = "true";
      api<{ user: Me }>("/api/auth/wathanpay", {
        method: "POST",
        body: JSON.stringify({ accessToken: token }),
      })
        .then((data) => setMe(data.user))
        .catch(() => undefined)
        .finally(() => setReady(true));
      return;
    }
    refresh()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
    if (window.WathanPay?.close) window.WathanPay.close();
  };

  return (
    <AuthContext.Provider value={{ me, ready, miniApp, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
