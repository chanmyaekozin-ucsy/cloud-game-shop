"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatWhen } from "@/lib/format";

type SupplierStatus = {
  session: {
    present: boolean;
    valid: boolean;
    region: string;
    savedAt: string | null;
    hasPhpSessid: boolean;
    path: string | null;
  };
  balance: string | null;
  error: string | null;
  orderUrl: string;
  checkedAt: string;
};

export default function AdminSupplierPage() {
  const [supplier, setSupplier] = useState<SupplierStatus | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [sessionInput, setSessionInput] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("br");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ supplier: SupplierStatus }>("/api/admin/supplier");
      setSupplier(data.supplier);
      if (data.supplier?.session?.region) {
        setSelectedRegion(data.supplier.session.region);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaveSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionInput.trim()) return;

    setSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      const isFullCookie = sessionInput.includes("=") && sessionInput.includes(";");
      const res = await api<{
        ok: boolean;
        message: string;
        supplier: SupplierStatus;
      }>("/api/admin/supplier", {
        method: "POST",
        body: JSON.stringify({
          phpsessid: isFullCookie ? undefined : sessionInput.trim(),
          cookieHeader: isFullCookie ? sessionInput.trim() : undefined,
          region: selectedRegion,
        }),
      });

      setSupplier(res.supplier);
      setSessionInput("");
      if (res.ok) {
        setSuccessMsg(res.message);
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update session");
    } finally {
      setSaving(false);
    }
  };

  const session = supplier?.session;
  const sessionLabel = !session?.present
    ? "Missing"
    : session.valid
      ? "Connected"
      : "Expired";
  const sessionClass = !session?.present
    ? "fail"
    : session.valid
      ? "on"
      : "promo";

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Supplier</h2>
          <p>Smile.one session and coin balance used for automatic diamond top-ups.</p>
        </div>
        <button className="btn small" type="button" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>

      {successMsg ? (
        <div
          style={{
            background: "var(--brand-soft)",
            color: "var(--brand-dark)",
            border: "1px solid var(--brand)",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 14,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ✅ {successMsg}
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
      {supplier?.error && !error ? <p className="err">{supplier.error}</p> : null}

      <div className="summary" style={{ marginBottom: 16 }}>
        <div className="muted">Smile Coin balance</div>
        <div className="big">{supplier?.balance ?? "—"}</div>
        <div className="row" style={{ borderTop: 0, marginTop: 8 }}>
          <span>Session Status</span>
          <b>
            <span className={`pill ${sessionClass}`}>{sessionLabel}</span>
          </b>
        </div>
        <div className="row">
          <span>Region</span>
          <b>{session?.region?.toUpperCase() || "—"}</b>
        </div>
        <div className="row">
          <span>Session Token</span>
          <b>
            <span className={`pill ${session?.hasPhpSessid ? "on" : "fail"}`}>
              {session?.hasPhpSessid ? "Configured" : "Missing"}
            </span>
          </b>
        </div>
        <div className="row">
          <span>Last Saved</span>
          <b>{session?.savedAt ? formatWhen(session.savedAt) : "—"}</b>
        </div>
        <div className="row">
          <span>Last Checked</span>
          <b>{supplier?.checkedAt ? formatWhen(supplier.checkedAt) : "—"}</b>
        </div>
        <div className="row">
          <span>Order Page URL</span>
          <b style={{ wordBreak: "break-all", fontWeight: 500 }}>{supplier?.orderUrl || "—"}</b>
        </div>
        <div className="row">
          <span>Persistent File Path</span>
          <b style={{ wordBreak: "break-all", fontWeight: 500, fontFamily: "monospace", fontSize: 12 }}>
            {session?.path || "../.data/smileone_session.json"}
          </b>
        </div>
      </div>

      <div className="summary" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Update Session</h3>
        <p className="hint" style={{ marginBottom: 14 }}>
          Update the Smile.one session cookie persistently. The web shop and Telegram bot balance monitor will immediately use this updated session.
        </p>

        <form onSubmit={handleSaveSession}>
          <div className="field">
            <label>New Session Token / Cookie</label>
            <input
              type="password"
              placeholder="Paste new PHPSESSID or full cookie header"
              value={sessionInput}
              onChange={(e) => setSessionInput(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 13 }}
              required
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label>Smile.one Region</label>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
            >
              <option value="br">Brazil (BR - default)</option>
              <option value="id">Indonesia (ID)</option>
              <option value="my">Malaysia (MY)</option>
              <option value="ph">Philippines (PH)</option>
              <option value="sg">Singapore (SG)</option>
              <option value="th">Thailand (TH)</option>
            </select>
          </div>

          <button className="btn" type="submit" disabled={saving || !sessionInput.trim()}>
            {saving ? "Saving & Verifying with Smile.one…" : "Save & Verify Session"}
          </button>
        </form>
      </div>

      <p className="hint">
        💡 <strong>How to retrieve Session Token:</strong> Log in to{" "}
        <a
          href="https://www.smile.one"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline" }}
        >
          smile.one
        </a>{" "}
        in your browser → Open DevTools (F12) → <em>Application</em> tab → <em>Cookies</em> → Copy the
        value of <code>PHPSESSID</code> and paste it into the password box above.
      </p>
    </>
  );
}
