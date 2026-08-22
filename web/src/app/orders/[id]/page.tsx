"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import { WathanPay } from "@/sdk/wathanpay";
import type { Order } from "@/lib/types";

type PayMethod = {
  id: string;
  method: string;
  accountNumber?: string;
  accountName?: string;
};

function markKind(status: Order["status"]) {
  if (status === "success") return "ok";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "awaiting_payment") return "wait";
  if (status === "processing" || status === "paid") return "wait";
  return "muted";
}

function titleFor(status: Order["status"]) {
  if (status === "success") return "Top-up successful";
  if (status === "failed") return "Order failed";
  if (status === "cancelled") return "Order cancelled";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "processing" || status === "paid") return "Payment Confirmed (Fulfilling)";
  return orderStatusLabel(status);
}

async function payWithWathanPay(input: {
  orderId: string;
  amount: number;
  title?: string;
  subtitle?: string;
}) {
  const result = await WathanPay.pay({
    orderId: input.orderId,
    amount: input.amount,
    title: input.title,
    subtitle: input.subtitle,
  });
  if (!result.ok) {
    throw new Error(result.error || result.message || "Payment cancelled.");
  }
  return String(result.txid || "");
}

export default function OrderResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { miniApp, ready } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payStep, setPayStep] = useState<"idle" | "methods" | "confirm">("idle");
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [selected, setSelected] = useState<PayMethod | null>(null);
  const [last5, setLast5] = useState("");
  const [copied, setCopied] = useState(false);
  const autoPay = useRef(false);

  const load = () =>
    api<{ order: Order }>(`/api/orders/${id}`).then((data) => {
      setOrder(data.order);
      return data.order;
    });

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Order not found"));
  }, [id]);

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${id}`, { method: "DELETE" });
      setPayStep("idle");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  };

  const retryWallet = async (current: Order) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${current.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: "wathanpay" }),
      });
      const txid = await payWithWathanPay({
        orderId: current.id,
        amount: current.amountKs,
        title: `${current.gameName} - ${current.packageName}`,
        subtitle: `Player: ${current.nickname || current.gameUserId}${current.zoneId ? ` (${current.zoneId})` : ""}`,
      });
      await api(`/api/orders/${current.id}/paid`, {
        method: "POST",
        body: JSON.stringify({ txid }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pay with WathanPay");
    } finally {
      setBusy(false);
    }
  };

  const openGatewayPay = async (current: Order) => {
    setError("");
    setBusy(true);
    try {
      const data = await api<{ methods: PayMethod[] }>("/api/payment-methods");
      setMethods(data.methods);
      const match = data.methods.find((method) => method.method === current.paymentMethod);
      setSelected(match ?? data.methods[0] ?? null);
      setPayStep(current.depositId || current.payeePhone ? "confirm" : "methods");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payment methods");
    } finally {
      setBusy(false);
    }
  };

  const startPay = async (current: Order) => {
    if (miniApp) {
      await retryWallet(current);
      return;
    }
    await openGatewayPay(current);
  };

  useEffect(() => {
    if (!order || !ready || autoPay.current) return;
    if (order.status !== "awaiting_payment") return;
    if (new URLSearchParams(window.location.search).get("pay") !== "1") return;
    autoPay.current = true;
    window.history.replaceState(null, "", `/orders/${order.id}`);
    void startPay(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, ready, miniApp]);

  const startGatewayPay = async () => {
    if (!selected || !order) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<{ order: Order }>(`/api/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: selected.id }),
      });
      setOrder(paid.order);
      setPayStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  const confirmPay = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${order.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ last5 }),
      });
      setPayStep("idle");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const copyPhone = async () => {
    if (!order?.payeePhone) return;
    await navigator.clipboard.writeText(order.payeePhone);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const status = order?.status ?? "awaiting_payment";
  const kind = markKind(status);
  const awaiting = status === "awaiting_payment";

  return (
    <ShopShell title="Order" backHref="/orders">
      {error ? <p className="err" style={{ padding: 16 }}>{error}</p> : null}
      {order ? (
        <>
          <div className="result">
            <div className={`result-mark ${kind}`}>
              {kind === "ok" ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M6 12.5l4 4 8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : kind === "bad" ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2.2" />
                  <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <h1>{titleFor(status)}</h1>
            <div className="amount">{formatKs(order.amountKs)}</div>
            <p>
              {order.packageName} for {order.nickname || `${order.gameUserId}(${order.zoneId})`}
            </p>
            {order.status === "processing" ? (
              <div
                style={{
                  background: "#fff4dd",
                  color: "#9a6b12",
                  borderRadius: 12,
                  padding: "10px 14px",
                  marginTop: 12,
                  fontSize: 13,
                  textAlign: "left",
                  lineHeight: 1.45,
                }}
              >
                <strong>Payment Received:</strong> Automated top-up is processing or awaiting manual fulfillment. An admin has been notified and will fulfill your diamonds shortly.
              </div>
            ) : order.failReason ? (
              <p className="err" style={{ marginTop: 10 }}>{order.failReason}</p>
            ) : null}
          </div>
          <div className="pad">
            <div className="summary">
              <div className="row" style={{ borderTop: 0 }}>
                <span>Status</span>
                <b>{orderStatusLabel(order.status)}</b>
              </div>
              <div className="row">
                <span>Game</span>
                <b>{order.gameName}</b>
              </div>
              <div className="row">
                <span>Package</span>
                <b>{order.packageName}</b>
              </div>
              <div className="row">
                <span>Account</span>
                <b>
                  {order.nickname}
                  {order.gameUserId ? ` · ${order.gameUserId}` : ""}
                  {order.zoneId ? `(${order.zoneId})` : ""}
                </b>
              </div>
              {order.paymentMethod ? (
                <div className="row">
                  <span>Method</span>
                  <b>{order.paymentMethod}</b>
                </div>
              ) : null}
              {payStep === "confirm" && order.payeeName ? (
                <div className="row">
                  <span>Name</span>
                  <b>{order.payeeName}</b>
                </div>
              ) : null}
              {payStep === "confirm" && order.payeePhone ? (
                <div className="row">
                  <span>Number</span>
                  <b>{order.payeePhone}</b>
                </div>
              ) : null}
              <div className="row">
                <span>Placed</span>
                <b>{formatWhen(order.createdAt)}</b>
              </div>
              {order.txid ? (
                <div className="row">
                  <span>TxID</span>
                  <b>{order.txid}</b>
                </div>
              ) : null}
            </div>

            {awaiting && payStep === "idle" ? (
              <button
                className="btn"
                disabled={busy || !ready}
                type="button"
                onClick={() => void startPay(order)}
                style={{ marginBottom: 8 }}
              >
                {busy ? "Paying…" : "Pay Now"}
              </button>
            ) : null}

            {awaiting && payStep === "methods" ? (
              <>
                <p className="hint">Choose how to pay. Transfer the exact amount, then confirm with TxID.</p>
                <div className="pay-list">
                  {methods.map((method) => (
                    <button
                      key={method.id}
                      className={selected?.id === method.id ? "pay-method on" : "pay-method"}
                      type="button"
                      onClick={() => setSelected(method)}
                    >
                      <span className={`pay-mark ${method.method === "WavePay" ? "wave" : "kbz"}`}>
                        {method.method === "WavePay" ? "W" : "K"}
                      </span>
                      <span>
                        <b>{method.method}</b>
                        <span className="pay-sub">
                          {method.accountName || method.method}
                          {method.accountNumber ? ` · ${method.accountNumber}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="btn"
                  style={{ marginTop: 16, marginBottom: 8 }}
                  disabled={!selected || busy}
                  type="button"
                  onClick={() => void startGatewayPay()}
                >
                  {busy ? "Starting…" : "Continue"}
                </button>
              </>
            ) : null}

            {awaiting && payStep === "confirm" ? (
              <>
                {order.payeePhone ? (
                  <button className="btn ghost" type="button" onClick={() => void copyPhone()} style={{ marginBottom: 14 }}>
                    {copied ? "Copied" : "Copy number"}
                  </button>
                ) : null}
                <label className="field">
                  TxID last 5
                  <input
                    value={last5}
                    onChange={(e) => setLast5(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    placeholder="•••••"
                  />
                </label>
                <p className="hint">From the {order.paymentMethod || "payment"} receipt, after you transfer the exact amount.</p>
                <button
                  className="btn"
                  disabled={busy || last5.length !== 5}
                  type="button"
                  onClick={() => void confirmPay()}
                  style={{ marginBottom: 8 }}
                >
                  {busy ? "Confirming…" : "Confirm order"}
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  type="button"
                  onClick={() => setPayStep("methods")}
                  style={{ marginBottom: 8 }}
                >
                  Use another method
                </button>
              </>
            ) : null}

            {awaiting ? (
              <button className="btn ghost" disabled={busy} type="button" onClick={() => void cancel()} style={{ marginBottom: 8 }}>
                {busy ? "Cancelling…" : "Cancel order"}
              </button>
            ) : null}
            <button className={awaiting ? "btn ghost" : "btn"} type="button" onClick={() => router.push("/orders")}>
              Back to orders
            </button>
          </div>
        </>
      ) : null}
      {busy && miniApp && awaiting ? (
        <div className="busy">
          <div className="spinner" />
        </div>
      ) : null}
    </ShopShell>
  );
}
