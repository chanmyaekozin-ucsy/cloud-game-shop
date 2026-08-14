"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatKs, formatWhen } from "@/lib/format";

type Row = {
  id: string;
  orderId: string;
  amountKs: number;
  method: string;
  txid: string | null;
  status: string;
  note: string;
  createdAt: string;
  user: { name: string; phone: string };
};

export default function AdminTransactionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    return api<{ transactions: Row[] }>(`/api/admin/transactions?${params}`).then((r) =>
      setRows(r.transactions),
    );
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Transactions</h2>
          <p>WathanPay in-app charges for Cloud Game Shop orders.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
        }}
      >
        <input className="box" placeholder="Search txid, user" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="box" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All status</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <button className="btn small" type="submit">
          Filter
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>TxID</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{formatWhen(t.createdAt)}</td>
                  <td>
                    <b>{t.user.name || "WathanPay"}</b>
                    <div className="muted">{t.user.phone || t.orderId}</div>
                  </td>
                  <td>{t.txid || "—"}</td>
                  <td>{formatKs(t.amountKs)}</td>
                  <td>
                    <span className={`pill ${t.status === "succeeded" ? "on" : t.status === "failed" ? "fail" : "promo"}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
