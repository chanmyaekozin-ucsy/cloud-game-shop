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
    phpsessid: string | null;
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
  const [phpsessid, setPhpsessid] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("br");
  const [showCookieHeader, setShowCookieHeader] = useState(false);
  const [cookieHeader, setCookieHeader] = useState("");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ supplier: SupplierStatus }>("/api/admin/supplier");
      setSupplier(data.supplier);
      if (data.supplier?.session?.region) {
        setSelectedRegion(data.supplier.session.region);
      }
      if (data.supplier?.session?.phpsessid) {
        setPhpsessid(data.supplier.session.phpsessid);
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
    setSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await api<{
        ok: boolean;
        message: string;
        supplier: SupplierStatus;
      }>("/api/admin/supplier", {
        method: "POST",
        body: JSON.stringify({
          phpsessid: phpsessid.trim() || undefined,
          cookieHeader: showCookieHeader && cookieHeader.trim() ? cookieHeader.trim() : undefined,
          region: selectedRegion,
        }),
      });

      setSupplier(res.supplier);
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
          <span>PHPSESSID</span>
          <b>
            {session?.hasPhpSessid ? (
              <span style={{ fontFamily: "monospace", fontSize: 13 }}>
                {session.phpsessid
                  ? `${session.phpsessid.slice(0, 8)}...${session.phpsessid.slice(-4)}`
                  : "Present"}
              </span>
            ) : (
              "Missing"
            )}
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
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Update Session & PHPSESSID</h3>
        <p className="hint" style={{ marginBottom: 14 }}>
          Update the Smile.one session cookie persistently. The web shop and Telegram bot balance monitor will immediately use this updated session.
        </p>

        <form onSubmit={handleSaveSession}>
          <div className="field">
            <label>PHPSESSID Token / Cookie Value</label>
            <input
              type="text"
              placeholder="e.g. 6jufhq1vcjrpbguqgg0766rq77 (or paste full cookie string)"
              value={phpsessid}
              onChange={(e) => setPhpsessid(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 13 }}
              required={!cookieHeader}
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

          {showCookieHeader ? (
            <div className="field">
              <label>Full Cookie Header (Optional Override)</label>
              <textarea
                rows={3}
                placeholder="Paste full Cookie header if needed: _gcl_au=...; PHPSESSID=...; _csrf=..."
                value={cookieHeader}
                onChange={(e) => setCookieHeader(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="linkish"
                onClick={() => setShowCookieHeader(true)}
              >
                + Paste full cookie header instead
              </button>
            </div>
          )}

          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving & Verifying with Smile.one…" : "Save & Verify Session"}
          </button>
        </form>
      </div>

      <p className="hint">
        💡 <strong>How to retrieve PHPSESSID:</strong> Log in to{" "}
        <a
          href="https://www.smile.one"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline" }}
        >
          smile.one
        </a>{" "}
        in your browser → Open DevTools (F12) → <em>Application</em> tab → <em>Cookies</em> → Copy the
        value of <code>PHPSESSID</code> and paste it above.
      </p>
    </>
  );
}
