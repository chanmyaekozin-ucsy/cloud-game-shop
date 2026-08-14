import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { updateStore } from "@/lib/store";
import type { Transaction } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { txid?: string };
    const txid = String(body.txid ?? "").trim();
    if (!txid) {
      return Response.json({ error: "Missing WathanPay payment id." }, { status: 400 });
    }

    const result = await updateStore((store) => {
      const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (order.status === "success" && order.txid === txid) {
        return { order, transaction: store.transactions.find((t) => t.orderId === order.id) ?? null };
      }
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      order.paymentMethod = "WathanPay";
      order.status = "success";
      order.txid = txid;
      order.failReason = null;
      order.completedAt = new Date().toISOString();
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
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);
      return { order, transaction: txn };
    });

    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
