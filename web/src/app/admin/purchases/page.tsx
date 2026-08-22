"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

type Action = "decline" | "approve" | "already_approve";

export default function AdminPurchasesPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  const apply = () => {
    setError("");
    setSuccess("");
    load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  };

  const runAction = async (order: Order, action: Action) => {
    setOpenMenuId(null);
    setError("");
    setSuccess("");

    const labels: Record<Action, string> = {
      decline: "Decline this order and mark it as failed?",
      approve: "Purchase this package on Smile.one and mark completed?",
      already_approve: "Mark this order as completed without purchasing?",
    };
    if (!window.confirm(labels[action])) return;

    setBusyId(order.id);
    try {
      const res = await api<{ order: Order; message?: string }>(`/api/admin/purchases/${order.id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setRows((prev) => prev.map((r) => (r.id === res.order.id ? res.order : r)));
      setSuccess(res.message || "Updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      // Refresh so failReason from a failed Approve attempt is visible
      await load().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
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
      {success ? (
        <p
          style={{
            background: "#e6f7ef",
            color: "#0f7f4e",
            border: "1px solid #c2eed9",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {success}
        </p>
      ) : null}
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
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  No purchases yet.
                </td>
              </tr>
            ) : (
              rows.map((o) => {
                const isProcessing = o.status === "processing";
                const isBusy = busyId === o.id;
                const menuOpen = openMenuId === o.id;
                return (
                  <tr key={o.id}>
                    <td className="muted">{formatWhen(o.createdAt)}</td>
                    <td>{o.gameName}</td>
                    <td>
                      <b>{o.nickname || "—"}</b>
                      <div className="muted">
                        {o.gameUserId}
                        {o.zoneId ? `(${o.zoneId})` : ""}
                      </div>
                    </td>
                    <td>{o.packageName}</td>
                    <td>{formatKs(o.amountKs)}</td>
                    <td>{o.paymentMethod || "—"}</td>
                    <td>
                      <span
                        className={`pill ${
                          o.status === "success"
                            ? "on"
                            : o.status === "failed" || o.status === "cancelled"
                              ? "fail"
                              : o.status === "processing"
                                ? "promo"
                                : ""
                        }`}
                      >
                        {isBusy ? "Working…" : orderStatusLabel(o.status)}
                      </span>
                      {isProcessing && o.failReason ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 220 }}>
                          {o.failReason}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right", position: "relative" }}>
                      {isProcessing ? (
                        <div ref={menuOpen ? menuRef : undefined} style={{ display: "inline-block" }}>
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={isBusy}
                            aria-label="Order actions"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(menuOpen ? null : o.id);
                            }}
                            style={{
                              width: 34,
                              height: 34,
                              padding: 0,
                              borderRadius: 8,
                              fontSize: 18,
                              lineHeight: 1,
                              letterSpacing: 1,
                            }}
                          >
                            ···
                          </button>
                          {menuOpen ? (
                            <div
                              role="menu"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: "100%",
                                marginTop: 4,
                                minWidth: 180,
                                background: "var(--white)",
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                boxShadow: "0 8px 24px rgba(16,42,67,0.12)",
                                zIndex: 20,
                                padding: 4,
                                textAlign: "left",
                              }}
                            >
                              <MenuItem
                                label="Approve"
                                hint="Buy on Smile.one"
                                onClick={() => void runAction(o, "approve")}
                              />
                              <MenuItem
                                label="Already Approve"
                                hint="Mark completed"
                                onClick={() => void runAction(o, "already_approve")}
                              />
                              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                              <MenuItem
                                label="Decline"
                                hint="Mark as failed"
                                danger
                                onClick={() => void runAction(o, "decline")}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MenuItem({
  label,
  hint,
  danger,
  onClick,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderRadius: 8,
        padding: "8px 10px",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#fde8ea" : "var(--bg-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: danger ? "var(--danger)" : "var(--text)" }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{hint}</div>
    </button>
  );
}
