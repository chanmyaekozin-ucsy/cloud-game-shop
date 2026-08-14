"use client";

import { useEffect, useState } from "react";
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
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ supplier: SupplierStatus }>("/api/admin/supplier");
      setSupplier(data.supplier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
          <p>Smile.one session and coin balance used for top-ups.</p>
        </div>
        <button className="btn small" type="button" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {supplier?.error ? <p className="err">{supplier.error}</p> : null}

      <div className="summary" style={{ marginBottom: 16 }}>
        <div className="muted">Smile Coin balance</div>
        <div className="big">{supplier?.balance ?? "—"}</div>
        <div className="row" style={{ borderTop: 0, marginTop: 8 }}>
          <span>Session</span>
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
          <b>{session?.hasPhpSessid ? "Present" : "Missing"}</b>
        </div>
        <div className="row">
          <span>Saved</span>
          <b>{session?.savedAt ? formatWhen(session.savedAt) : "—"}</b>
        </div>
        <div className="row">
          <span>Checked</span>
          <b>{supplier?.checkedAt ? formatWhen(supplier.checkedAt) : "—"}</b>
        </div>
        <div className="row">
          <span>Order page</span>
          <b style={{ wordBreak: "break-all", fontWeight: 500 }}>{supplier?.orderUrl || "—"}</b>
        </div>
      </div>

      <p className="hint">
        Session file is shared with the Telegram bot at{" "}
        <code>{session?.path || "../.data/smileone_session.json"}</code>. Refresh login with the bot
        scripts if the session expires.
      </p>
    </>
  );
}
