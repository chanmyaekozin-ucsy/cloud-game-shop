"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function OrdersPage() {
  const { me, ready } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !me) return;
    api<{ orders: Order[] }>("/api/orders")
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load orders"));
  }, [ready, me]);

  return (
    <ShopShell title="Orders" backHref="/">
      <div className="pad">
        {error ? <p className="err">{error}</p> : null}
        {!me ? (
          <p className="empty">
            Sign in to see purchases. <Link href="/login">Sign in</Link>
          </p>
        ) : orders.length === 0 ? (
          <p className="empty">No purchases yet.</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="list-row">
              <Link href={`/orders/${order.id}`} className="list-main">
                <div>
                  <b>
                    {order.gameName} · {order.packageName}
                  </b>
                  <div className="sub">
                    {order.nickname} · {formatWhen(order.createdAt)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <b>{formatKs(order.amountKs)}</b>
                  <div className={`sub status-${order.status}`}>{orderStatusLabel(order.status)}</div>
                </div>
              </Link>
              {order.status === "awaiting_payment" ? (
                <Link href={`/orders/${order.id}?pay=1`} className="btn small">
                  Pay Now
                </Link>
              ) : null}
            </div>
          ))
        )}
      </div>
    </ShopShell>
  );
}
