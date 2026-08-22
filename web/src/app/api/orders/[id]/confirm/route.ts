import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { failedStatus, paidStatus, verifyDepositLast5 } from "@/lib/dominate";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore, updateStore } from "@/lib/store";
import { paySmileoneMlbb } from "@/lib/smileone";
import { sendAdminManualTopupAlert } from "@/lib/telegram-alert";
import { verifyWathanPayPayment } from "@/lib/wathanpay";
import type { Order, Transaction } from "@/lib/types";

function finish(
  order: Order,
  txn: Transaction,
  input: { status: Order["status"]; txid: string; message: string; txnStatus: Transaction["status"] },
) {
  order.status = input.status;
  order.txid = input.txid;
  order.failReason = input.status === "failed" ? input.message : null;
  order.completedAt = new Date().toISOString();
  txn.status = input.txnStatus;
  txn.txid = input.txid;
  txn.note = input.message;
}

function newTxnId() {
  return `txn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;

    const ip = getClientIp(req);
    const rlIp = checkRateLimit(`confirm:${ip}`, 10, 60 * 1000);
    if (!rlIp.ok) return rateLimitResponse(rlIp.resetAt);

    const rlOrder = checkRateLimit(`confirm_order:${id}`, 6, 60 * 1000);
    if (!rlOrder.ok) return rateLimitResponse(rlOrder.resetAt);

    const body = (await req.json()) as { last5?: string };
    const last5 = String(body.last5 ?? "").replace(/\D/g, "").slice(0, 5);
    if (last5.length !== 5) {
      return Response.json({ error: "Enter the last 5 digits of the TxID." }, { status: 400 });
    }

    const preview = await readStore();
    const existing = preview.orders.find((o) => o.id === id && o.userId === session.sub);
    if (!existing) return Response.json({ error: "Order not found." }, { status: 404 });
    if (existing.status !== "awaiting_payment") {
      return Response.json({ error: "This order is already closed." }, { status: 409 });
    }

    let topupFailedReason: string | null = null;
    let finalOrder: Order | null = null;

    if (existing.depositId) {
      let deposit;
      try {
        deposit = await verifyDepositLast5(existing.depositId, last5);
      } catch (err: unknown) {
        const errObj = err as { status?: number; isProviderBusy?: boolean };
        if (errObj?.status === 503 || errObj?.isProviderBusy) {
          return Response.json(
            {
              error: "Payment provider is currently busy or synchronizing. Please wait a few seconds and try confirming again.",
              retry: true,
            },
            { status: 503 },
          );
        }
        throw err;
      }

      const status = String(deposit.status || "");
      const txid = String(deposit.matched_order_id || deposit.bank_trx_id || deposit.trx_id || "");

      if (status === "pending") {
        return Response.json(
          { error: "Payment not found yet. Pay the exact amount, then send the last 5 digits again." },
          { status: 409 },
        );
      }

      const result = await updateStore(async (store) => {
        const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
        if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
        const txn: Transaction = {
          id: newTxnId(),
          orderId: order.id,
          userId: order.userId,
          amountKs: order.amountKs,
          method: order.paymentMethod || "KBZPay",
          txid,
          status: "pending",
          note: order.paymentMethod,
          createdAt: new Date().toISOString(),
        };
        store.transactions.push(txn);

        if (failedStatus(status) || !paidStatus(status)) {
          finish(order, txn, {
            status: "failed",
            txid,
            message: deposit.verify_reason || "Payment failed.",
            txnStatus: "failed",
          });
        } else if (!txid) {
          finish(order, txn, {
            status: "failed",
            txid,
            message: "Gateway did not return a transaction reference. Payment will be reviewed.",
            txnStatus: "pending",
          });
          order.status = "processing";
        } else {
          finish(order, txn, {
            status: "success",
            txid,
            message: `${order.paymentMethod} ${txid}`,
            txnStatus: "succeeded",
          });

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
        }
        finalOrder = order;
        return { order, transaction: txn };
      });

      if (topupFailedReason && finalOrder) {
        void sendAdminManualTopupAlert(finalOrder, topupFailedReason);
      }

      return Response.json(result);
    }

    // WathanPay path: only a verified ledger result can settle the order.
    // There is no local balance-spending fallback.
    const verification = await verifyWathanPayPayment(id, existing.amountKs);
    if (!verification.ok || !verification.transactionId) {
      return Response.json(
        { error: verification.error || "WathanPay payment verification failed." },
        { status: 400 },
      );
    }
    const txid = verification.transactionId;

    const result = await updateStore(async (store) => {
      const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) {
        throw Object.assign(new Error("Order not found."), { status: 404 });
      }
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      const txn: Transaction = {
        id: newTxnId(),
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: "WathanPay",
        txid,
        status: "pending",
        note: "WathanPay in-app",
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);

      finish(order, txn, {
        status: "success",
        txid,
        message: "Paid with WathanPay",
        txnStatus: "succeeded",
      });

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
