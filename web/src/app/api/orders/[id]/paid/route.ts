import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore, updateStore } from "@/lib/store";
import { paySmileoneMlbb } from "@/lib/smileone";
import { sendAdminManualTopupAlert } from "@/lib/telegram-alert";
import { verifyWathanPayPayment } from "@/lib/wathanpay";
import type { Order, Transaction } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const ip = getClientIp(req);
    const rl = checkRateLimit(`order_paid:${session.sub || ip}`, 15, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { txid?: string };
    const clientTxid = String(body.txid ?? "").trim();

    const store = await readStore();
    const existing = store.orders.find((o) => o.id === id && o.userId === session.sub);
    if (!existing) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    if (existing.status === "success" && (existing.txid === clientTxid || !clientTxid)) {
      return Response.json({
        order: existing,
        transaction: store.transactions.find((t) => t.orderId === existing.id) ?? null,
      });
    }

    if (existing.status !== "awaiting_payment") {
      return Response.json({ error: "This order is already closed." }, { status: 409 });
    }

    // Verify on WathanPay ledger (if WATHANPAY_API_KEY is set)
    const verification = await verifyWathanPayPayment(existing.id, existing.amountKs);
    if (!verification.ok) {
      return Response.json(
        { error: verification.error || "WathanPay payment verification failed." },
        { status: 400 },
      );
    }

    const txid = verification.transactionId || clientTxid;
    if (!txid) {
      return Response.json({ error: "Missing WathanPay transaction ID." }, { status: 400 });
    }

    let topupFailedReason: string | null = null;
    let finalOrder: Order | null = null;

    const result = await updateStore(async (s) => {
      const order = s.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      order.paymentMethod = "WathanPay";
      order.txid = txid;
      order.completedAt = verification.paidAt || new Date().toISOString();
      order.payeeName = "WathanPay wallet";
      order.payeePhone = null;
      order.depositId = null;

      // Attempt MLBB auto top-up
      if (order.gameId === "mlbb") {
        const pkg = s.packages.find((p) => p.id === order.packageId);
        if (pkg?.smileGoodsId) {
          const topup = await paySmileoneMlbb({
            gameUserId: order.gameUserId,
            zoneId: order.zoneId,
            smileGoodsId: pkg.smileGoodsId,
          });
          if (topup.ok) {
            order.status = "success";
            order.failReason = null;
          } else {
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

      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}`,
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: "WathanPay",
        txid,
        status: "succeeded",
        note: "WathanPay in-app",
        createdAt: order.completedAt,
      };
      s.transactions.push(txn);
      finalOrder = order;
      return { order, transaction: txn };
    });

    if (topupFailedReason && finalOrder) {
      void sendAdminManualTopupAlert(finalOrder, topupFailedReason);
    }

    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
