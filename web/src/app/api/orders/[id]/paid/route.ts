import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";
import { verifyWathanPayPayment } from "@/lib/wathanpay";
import type { Transaction } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
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

    const result = await updateStore((s) => {
      const order = s.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      order.paymentMethod = "WathanPay";
      order.status = "success";
      order.txid = txid;
      order.failReason = null;
      order.completedAt = verification.paidAt || new Date().toISOString();
      order.payeeName = "WathanPay wallet";
      order.payeePhone = null;
      order.depositId = null;

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
      return { order, transaction: txn };
    });

    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
