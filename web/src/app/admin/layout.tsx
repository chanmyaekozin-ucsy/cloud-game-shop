"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/Auth";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/games", label: "Games" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/purchases", label: "Purchases" },
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/supplier", label: "Supplier" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me, ready, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (!ready || isLogin) return;
    if (!me) router.replace("/admin/login");
    else if (me.role !== "admin") router.replace("/");
  }, [ready, me, isLogin, router]);

  if (isLogin) return children;
  if (!ready || me?.role !== "admin") return null;

  return (
    <div className="shell">
      <aside className="nav">
        <div className="nav-brand">
          <img
            src="/logo.png"
            alt="Cloud Game Shop"
            width={32}
            height={32}
            style={{ borderRadius: 8, objectFit: "contain", flexShrink: 0 }}
          />
          <span>Cloud Game Shop</span>
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? "on" : ""}
          >
            {item.label}
          </Link>
        ))}
        <div className="nav-foot">
          <span>{me.email || me.name}</span>
          <button type="button" onClick={() => void logout().then(() => router.push("/admin/login"))}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
