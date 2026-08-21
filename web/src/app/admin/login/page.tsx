"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/Auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user?: { role: string }; requires2FA?: boolean; message?: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            identifier,
            password,
            totpCode: requires2FA ? totpCode : undefined,
          }),
        },
      );

      if (data.requires2FA) {
        setRequires2FA(true);
        setBusy(false);
        return;
      }

      if (data.user) {
        await refresh();
        if (data.user.role !== "admin") {
          setError("This account is not an admin.");
          return;
        }
        router.push("/admin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <img
          src="/logo.png"
          alt="Cloud Game Shop"
          width={56}
          height={56}
          style={{ margin: "0 auto 12px", borderRadius: 12, display: "block", objectFit: "contain" }}
        />
        <h1>{requires2FA ? "Two-Factor Verification" : "Admin Sign In"}</h1>
        <p>
          {requires2FA
            ? "Enter the 6-digit code from Google Authenticator"
            : "Cloud Game Shop control panel"}
        </p>

        {error ? <p className="err">{error}</p> : null}

        {!requires2FA ? (
          <>
            <label className="field">
              Email
              <input
                type="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </label>
            <button className="btn" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </>
        ) : (
          <>
            <label className="field">
              6-Digit Authenticator Code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                style={{
                  textAlign: "center",
                  fontSize: "22px",
                  letterSpacing: "0.25em",
                  fontFamily: "monospace",
                  fontWeight: "700",
                }}
                autoFocus
                required
              />
            </label>
            <button className="btn" disabled={busy || totpCode.length !== 6} type="submit">
              {busy ? "Verifying…" : "Verify & Continue"}
            </button>
            <button
              type="button"
              className="btn-sec"
              style={{ marginTop: "10px", width: "100%" }}
              onClick={() => {
                setRequires2FA(false);
                setTotpCode("");
                setError("");
              }}
            >
              Back to Password
            </button>
          </>
        )}
      </form>
    </div>
  );
}

