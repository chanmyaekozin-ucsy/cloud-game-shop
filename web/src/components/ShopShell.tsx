"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./Auth";

export function ShopShell({
  children,
  title,
  backHref,
  onBack,
}: {
  children: React.ReactNode;
  title?: string;
  backHref?: string;
  onBack?: () => void;
}) {
  const { me, miniApp, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const home = pathname === "/";

  return (
    <div className="shop">
      {home ? (
        <header className="topbar">
          <div className="topbar-row">
            <img src="/logo.png" alt="" width={40} height={40} />
            <div className="brand-name">Cloud Game Shop</div>
            <div className="topbar-actions">
              <Link className="linkish" href="/orders">
                Orders
              </Link>
              {me?.role === "admin" ? (
                <Link className="linkish" href="/admin">
                  Admin
                </Link>
              ) : null}
              {!miniApp && me ? (
                <button className="linkish" type="button" onClick={() => void logout()}>
                  Sign out
                </button>
              ) : null}
              {!miniApp && !me ? (
                <Link className="linkish" href="/login">
                  Sign in
                </Link>
              ) : null}
            </div>
          </div>
          <div className="brand-sub">
            အခုလွှဲ အခုရောက် စိတ်ချရတဲ့ <span className="accent">Cloud</span>
          </div>
        </header>
      ) : (
        <header className="screen-head">
          <button
            className="icon-btn"
            type="button"
            aria-label="Back"
            onClick={() => {
              if (onBack) onBack();
              else if (backHref) router.push(backHref);
              else router.back();
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="screen-title">{title}</div>
        </header>
      )}
      {children}
    </div>
  );
}
