"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function AdminPurchasesPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (paidBy) params.set("paidBy", paidBy);
    return api<{ orders: Order[] }>(`/api/admin/purchases?${params}`).then((r) => setRows(r.orders));
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    setError("");
    load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Purchases</h2>
          <p>Top-up orders: account, package, and delivery status.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          className="box"
          placeholder="Search nickname, ID, txid"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="box"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
        >
          <option value="">All status</option>
          <option value="success">Completed</option>
          <option value="awaiting_payment">Awaiting payment</option>
          <option value="processing">Processing</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="box"
          value={paidBy}
          onChange={(e) => {
            setPaidBy(e.target.value);
          }}
        >
          <option value="">All paid by</option>
          <option value="wathanpay">WathanPay</option>
          <option value="kbzpay">KBZPay</option>
          <option value="wavepay">WavePay</option>
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
              <th>Game</th>
              <th>Account</th>
              <th>Package</th>
              <th>Amount</th>
              <th>Paid by</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No purchases yet.
                </td>
              </tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id}>
                  <td className="muted">{formatWhen(o.createdAt)}</td>
                  <td>{o.gameName}</td>
                  <td>
                    <b>{o.nickname || "—"}</b>
                    <div className="muted">
                      {o.gameUserId}{o.zoneId ? `(${o.zoneId})` : ""}
                    </div>
                  </td>
                  <td>{o.packageName}</td>
                  <td>{formatKs(o.amountKs)}</td>
                  <td>{o.paymentMethod || "—"}</td>
                  <td>
                    <span className={`pill ${o.status === "success" ? "on" : o.status === "failed" || o.status === "cancelled" ? "fail" : ""}`}>
                      {orderStatusLabel(o.status)}
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
