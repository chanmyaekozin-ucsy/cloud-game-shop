import { NextRequest } from "next/server";
import { failedStatus, paidStatus, getDeposit, verifyWebhookSignature, type GatewayDeposit } from "@/lib/dominate";
import { seenWebhookEvent, updateStore } from "@/lib/store";
import { paySmileoneMlbb } from "@/lib/smileone";
import { sendAdminManualTopupAlert } from "@/lib/telegram-alert";
import type { Order, Transaction } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature =
      req.headers.get("x-signature-sha256") ||
      req.headers.get("x-signature") ||
      "";

    // Fail closed: unsigned or unverifiable webhooks are always rejected.
    // If no secret is configured the signature check itself fails.
    if (!verifyWebhookSignature(rawBody, signature)) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    let payload: GatewayDeposit;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const depositId = String(payload.id || "");
    if (!depositId) {
      return Response.json({ error: "Missing deposit id." }, { status: 400 });
    }

    // Idempotency: drop duplicate deliveries by deposit id + status.
    const eventId = `${depositId}:${String(payload.status || "")}`;
    if (seenWebhookEvent(eventId)) {
      return Response.json({ ok: true, message: "Duplicate event ignored." }, { status: 200 });
    }

    const externalRef = payload.external_ref || "";
    const cleanOrderId = externalRef.replace(/^cgs-web-/, "").replace(/^cgs-/, "");
    const status = String(payload.status || "");

    let topupFailedReason: string | null = null;
    let finalOrder: Order | null = null;

    const result = await updateStore(async (store) => {
      const order = store.orders.find(
        (o) =>
          (depositId && o.depositId === depositId) ||
          (cleanOrderId && o.id === cleanOrderId) ||
          (externalRef && o.id === externalRef),
      );

      if (!order) {
        return { ok: true, message: "Order not found in store; ignored." };
      }

      // If already finalized, avoid double-processing
      if (order.status !== "awaiting_payment") {
        return { ok: true, message: `Order ${order.id} already has status ${order.status}.` };
      }

      // Amount binding: trust only a fresh server-side read of the deposit,
      // never the webhook body, before marking anything paid.
      if (paidStatus(status)) {
        try {
          const fresh = await getDeposit(depositId);
          if (!paidStatus(String(fresh.status || ""))) {
            return { ok: false, message: "Deposit not paid per gateway re-check; ignored." };
          }
          if (Number(fresh.amount_ks) !== Number(order.amountKs)) {
            return { ok: false, message: `Amount mismatch: gateway ${fresh.amount_ks} vs order ${order.amountKs}.` };
          }
        } catch (err) {
          console.error("Gateway deposit re-check failed:", err);
          return { ok: false, message: "Gateway verification unavailable; order left pending." };
        }
      }

      const txid = String(
        payload.matched_order_id ||
        payload.bank_trx_id ||
        payload.trx_id ||
        payload.submitted_last5 ||
        depositId ||
        "WEBHOOK_PAID",
      );

      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: order.paymentMethod || payload.provider || "Gateway",
        txid,
        status: "pending",
        note: `Gateway webhook: ${status}`,
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);

      if (paidStatus(status)) {
        order.status = "success";
        order.txid = txid;
        order.completedAt = new Date().toISOString();
        order.failReason = null;
        txn.status = "succeeded";
        txn.note = `Paid via ${order.paymentMethod || "Gateway"}`;

        if (order.gameId === "mlbb") {
          const pkg = store.packages.find((p) => p.id === order.packageId);
          if (pkg?.smileGoodsId) {
            const topup = await paySmileoneMlbb({
              gameUserId: order.gameUserId,
              zoneId: order.zoneId,
              smileGoodsId: pkg.smileGoodsId,
            });
            if (!topup.ok) {
              order.status = "processing";
              order.failReason = `Auto-topup failed: ${topup.message}`;
              topupFailedReason = topup.message;
            }
          } else {
            order.status = "processing";
            order.failReason = "Awaiting manual fulfillment";
            topupFailedReason = "No SmileGoods ID configured";
          }
        } else {
          order.status = "processing";
          order.failReason = "Awaiting manual fulfillment";
          topupFailedReason = "Manual delivery game";
        }
      } else if (failedStatus(status)) {
        order.status = "failed";
        order.txid = txid;
        order.failReason = payload.verify_reason || payload.error || "Payment expired or failed.";
        order.completedAt = new Date().toISOString();
        txn.status = "failed";
        txn.note = order.failReason;
      }

      finalOrder = order;
      return { ok: true, orderId: order.id, status: order.status };
    });

    if (topupFailedReason && finalOrder) {
      void sendAdminManualTopupAlert(finalOrder, topupFailedReason);
    }

    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error("Gateway webhook error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
