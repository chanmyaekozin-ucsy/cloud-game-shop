"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { discountLabel, formatKs, hasDiscount, salePriceKs } from "@/lib/format";
import type { Game, Package } from "@/lib/types";
import type { GameAccount } from "./types";

type Step = "account" | "packages" | "pay" | "confirm";
type PayMethod = {
  id: string;
  method: string;
  accountNumber?: string;
  accountName?: string;
};

async function payWithWathanPay(input: {
  orderId: string;
  amountKs: number;
  title?: string;
  subtitle?: string;
}) {
  const pay = window.WathanPay?.pay;
  if (!pay) {
    throw new Error("Open this shop from WathanPay to pay.");
  }
  const result = await pay(input);
  if (!result?.ok) {
    throw new Error(result?.message || "Payment cancelled.");
  }
  return String(result.txid || "");
}

export function Checkout({ slug }: { slug: string }) {
  const router = useRouter();
  const { me, ready, miniApp } = useAuth();
  const [step, setStep] = useState<Step>("packages");
  const [game, setGame] = useState<Game | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [values, setValues] = useState<Record<string, string>>({
    gameUserId: "",
    zoneId: "",
  });
  const [account, setAccount] = useState<GameAccount | null>(null);
  const [pkg, setPkg] = useState<Package | null>(null);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [selected, setSelected] = useState<PayMethod | null>(null);
  const [orderId, setOrderId] = useState("");
  const [payee, setPayee] = useState<{ name: string | null; phone: string | null; method: string } | null>(
    null,
  );
  const [last5, setLast5] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const orderIdRef = useRef("");
  const walletLaunch = useRef(false);

  useEffect(() => {
    api<{ game: Game; packages: Package[] }>(`/api/games/${slug}`)
      .then((data) => {
        setGame(data.game);
        setPackages(data.packages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Game not found"));
  }, [slug]);

  useEffect(() => {
    if (ready && !me && !miniApp && (step === "pay" || step === "confirm")) {
      router.replace(`/login?next=/play/${slug}`);
    }
  }, [ready, me, miniApp, router, step, slug]);

  useEffect(() => {
    if (miniApp || step !== "pay") return;
    setError("");
    api<{ methods: PayMethod[] }>("/api/payment-methods")
      .then((data) => {
        setMethods(data.methods);
        setSelected((current) => current ?? data.methods[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load payment methods"));
  }, [step, miniApp]);

  useEffect(() => {
    if (step !== "pay") {
      walletLaunch.current = false;
    }
  }, [step]);

  const fields = game?.fields ?? [
    { key: "gameUserId" as const, label: game?.idLabel ?? "Game ID", placeholder: "", numeric: true },
    { key: "zoneId" as const, label: game?.zoneLabel ?? "Server", placeholder: "", numeric: true },
  ].filter((field) => field.label);

  const titles: Record<Step, string> = {
    packages: "Price list",
    account: "Game ID",
    pay: "Payment",
    confirm: "Confirm",
  };
  const lastStep = miniApp ? 3 : 4;
  const stepNo = { packages: 1, account: 2, pay: 3, confirm: 4 }[step];

  const back = () => {
    setError("");
    if (step === "packages") router.push("/");
    else if (step === "account") setStep("packages");
    else if (step === "pay") setStep("account");
    else setStep("pay");
  };

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ account: GameAccount }>(`/api/games/${slug}/verify`, {
        method: "POST",
        body: JSON.stringify({
          gameUserId: values.gameUserId ?? "",
          zoneId: values.zoneId ?? "",
        }),
      });
      setAccount(data.account);
    } catch (err) {
      setAccount(null);
      setError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (!game || !pkg || !account) throw new Error("Choose a package first.");
    if (orderIdRef.current) return orderIdRef.current;
    const created = await api<{ order: { id: string } }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        gameId: game.id,
        packageId: pkg.id,
        gameUserId: account.gameUserId,
        zoneId: account.zoneId,
        nickname: account.nickname,
        region: account.region,
      }),
    });
    orderIdRef.current = created.order.id;
    setOrderId(created.order.id);
    return created.order.id;
  };

  const startWalletPay = async () => {
    if (!game || !pkg || !account || walletLaunch.current) return;
    walletLaunch.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await createOrder();
      await api(`/api/orders/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: "wathanpay" }),
      });
      const txid = await payWithWathanPay({
        orderId: id,
        amountKs: salePriceKs(pkg),
        title: game.name,
        subtitle: pkg.displayName,
      });
      const paid = await api<{ order: { id: string } }>(`/api/orders/${id}/paid`, {
        method: "POST",
        body: JSON.stringify({ txid }),
      });
      router.push(`/orders/${paid.order.id}`);
    } catch (err) {
      walletLaunch.current = false;
      setError(err instanceof Error ? err.message : "Could not pay with WathanPay");
    } finally {
      setBusy(false);
    }
  };

  const startGatewayPay = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const id = await createOrder();
      const paid = await api<{
        order: { payeeName: string | null; payeePhone: string | null; paymentMethod: string };
      }>(`/api/orders/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: selected.id }),
      });
      setPayee({
        name: paid.order.payeeName,
        phone: paid.order.payeePhone,
        method: paid.order.paymentMethod || selected.method,
      });
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  const confirmPay = async () => {
    if (!orderId) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<{ order: { id: string } }>(`/api/orders/${orderId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ last5 }),
      });
      router.push(`/orders/${paid.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const copyPhone = async () => {
    if (!payee?.phone) return;
    await navigator.clipboard.writeText(payee.phone);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ShopShell title={titles[step]} onBack={back}>
      <div className="steps" aria-hidden>
        {Array.from({ length: lastStep }, (_, i) => i + 1).map((n) => (
          <span key={n} style={{ display: "contents" }}>
            <span className={n <= stepNo ? "step on" : "step"}>{n}</span>
            {n < lastStep ? <span className={n < stepNo ? "step-line on" : "step-line"} /> : null}
          </span>
        ))}
      </div>

      <div className="pad">
        {error ? <p className="err">{error}</p> : null}

        {step === "packages" ? (
          <>
            <p className="hint">Choose a {(game?.packageLabel ?? "package").toLowerCase()} for {game?.name}.</p>
            <div className="pkg-list">
              {packages.map((item) => (
                <button
                  key={item.id}
                  className={pkg?.id === item.id ? "pkg on" : "pkg"}
                  type="button"
                  onClick={() => setPkg(item)}
                >
                  <span className="name">{item.displayName}</span>
                  {hasDiscount(item) ? <span className="pkg-off">{discountLabel(item)}</span> : null}
                  <span className="price">
                    {hasDiscount(item) ? <span className="was">{formatKs(item.priceKs)}</span> : null}
                    <span className="now">
                      {formatKs(salePriceKs(item)).replace(" Ks", "")}
                      <small>Ks</small>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="pkg-foot">
              <button
                className="btn"
                disabled={!pkg}
                type="button"
                onClick={() => {
                  setError("");
                  setAccount(null);
                  setStep("account");
                }}
              >
                Continue
              </button>
            </div>
          </>
        ) : null}

        {step === "account" ? (
          <>
            <p className="hint">
              {pkg ? `${pkg.displayName} · ${formatKs(salePriceKs(pkg))}. ` : ""}
              Enter your {fields.map((field) => field.label).join(" and ")}, then verify.
            </p>
            {fields.map((field) => (
              <label key={field.key} className="field">
                {field.label}
                <input
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [field.key]: field.numeric
                        ? e.target.value.replace(/\D/g, "")
                        : e.target.value,
                    })
                  }
                  inputMode={field.numeric ? "numeric" : "text"}
                  placeholder={field.placeholder}
                />
              </label>
            ))}
            <button className="btn" disabled={busy} type="button" onClick={() => void verify()}>
              {busy ? "Checking…" : "Verify"}
            </button>
            {account ? (
              <div className="account-card">
                <div className="nick">{account.nickname}</div>
                <div className="meta">
                  {account.gameUserId}
                  {account.zoneId ? `(${account.zoneId})` : ""} · {account.region}
                  {account.country ? ` · ${account.country}` : ""}
                </div>
              </div>
            ) : null}
            <button
              className="btn"
              style={{ marginTop: 8 }}
              disabled={!account || !pkg || (miniApp && (!ready || !me))}
              type="button"
              onClick={() => {
                if (!me && !miniApp) {
                  router.push(`/login?next=/play/${slug}`);
                  return;
                }
                orderIdRef.current = "";
                setOrderId("");
                setError("");
                setStep("pay");
                if (miniApp) void startWalletPay();
              }}
            >
              Continue
            </button>
          </>
        ) : null}

        {step === "pay" && miniApp ? (
          <>
            <p className="hint">Paying with WathanPay. Confirm with your wallet PIN.</p>
            <div className="summary">
              <div className="muted">Amount</div>
              {pkg && hasDiscount(pkg) ? <div className="was-line">{formatKs(pkg.priceKs)}</div> : null}
              <div className="big">{formatKs(pkg ? salePriceKs(pkg) : 0)}</div>
              <div className="row">
                <span>Game</span>
                <b>{game?.name}</b>
              </div>
              <div className="row">
                <span>Username</span>
                <b>{account?.nickname}</b>
              </div>
              <div className="row">
                <span>Package</span>
                <b>{pkg?.displayName}</b>
              </div>
              <div className="row">
                <span>Method</span>
                <b>WathanPay</b>
              </div>
            </div>
            <button
              className="btn"
              style={{ marginTop: 20 }}
              disabled={busy}
              type="button"
              onClick={() => void startWalletPay()}
            >
              {busy ? "Paying…" : "Pay with WathanPay"}
            </button>
          </>
        ) : null}

        {step === "pay" && !miniApp ? (
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
            {methods.length === 0 && !error ? (
              <p className="hint">No payment methods are enabled yet.</p>
            ) : null}
            <button
              className="btn"
              style={{ marginTop: 20 }}
              disabled={!selected || busy}
              type="button"
              onClick={() => void startGatewayPay()}
            >
              {busy ? "Starting…" : "Continue"}
            </button>
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <div className="summary">
              <div className="muted">Amount</div>
              {pkg && hasDiscount(pkg) ? <div className="was-line">{formatKs(pkg.priceKs)}</div> : null}
              <div className="big">{formatKs(pkg ? salePriceKs(pkg) : 0)}</div>
              <div className="row">
                <span>Game</span>
                <b>{game?.name}</b>
              </div>
              <div className="row">
                <span>Username</span>
                <b>{account?.nickname}</b>
              </div>
              <div className="row">
                <span>Package</span>
                <b>{pkg?.displayName}</b>
              </div>
              <div className="row">
                <span>Method</span>
                <b>{payee?.method || selected?.method}</b>
              </div>
              {payee?.name ? (
                <div className="row">
                  <span>Name</span>
                  <b>{payee.name}</b>
                </div>
              ) : null}
              {payee?.phone ? (
                <div className="row">
                  <span>Number</span>
                  <b>{payee.phone}</b>
                </div>
              ) : null}
            </div>
            {payee?.phone ? (
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
            <p className="hint">From the {payee?.method || "payment"} receipt, after you transfer the exact amount.</p>
            <button className="btn" disabled={busy || last5.length !== 5} type="button" onClick={() => void confirmPay()}>
              {busy ? "Confirming…" : "Confirm order"}
            </button>
          </>
        ) : null}
      </div>

      {busy && step !== "account" ? (
        <div className="busy">
          <div className="spinner" />
        </div>
      ) : null}
    </ShopShell>
  );
}
