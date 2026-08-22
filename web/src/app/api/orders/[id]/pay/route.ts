import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { createDeposit, listPaymentMethods } from "@/lib/dominate";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const ip = getClientIp(req);
    const rl = checkRateLimit(`order_pay:${session.sub || ip}`, 15, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const { id } = await params;
    const body = (await req.json()) as { accountId?: string };
    const accountId = String(body.accountId ?? "").trim();
    if (!accountId) {
      return Response.json({ error: "Choose a payment method." }, { status: 400 });
    }

    if (accountId === "wathanpay") {
      const order = await updateStore((store) => {
        const found = store.orders.find((o) => o.id === id && o.userId === session.sub);
        if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
        if (found.status !== "awaiting_payment") {
          throw Object.assign(new Error("This order is already closed."), { status: 409 });
        }
        found.paymentMethod = "WathanPay";
        found.depositId = null;
        found.payeeName = "WathanPay wallet";
        found.payeePhone = null;
        return found;
      });
      return Response.json({ order });
    }

    const methods = await listPaymentMethods();
    const method = methods.find((m) => m.id === accountId);
    if (!method) {
      return Response.json({ error: "That payment method is not available." }, { status: 400 });
    }

    const preview = await updateStore((store) => {
      const found = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (found.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }
      found.paymentMethod = method.method;
      found.payeeName = method.accountName;
      found.payeePhone = method.accountNumber;
      return found;
    });

    const host = req.headers.get("host");
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const callbackUrl = host && !host.includes("localhost") && !host.includes("127.0.0.1")
      ? `${protocol}://${host}/api/webhooks/gateway`
      : undefined;

    const deposit = await createDeposit({
      accountId: method.id,
      amountKs: preview.amountKs,
      orderId: preview.id,
      callbackUrl,
    });
    const payee = deposit.payee || {};
    const order = await updateStore((store) => {
      const found = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
      found.depositId = deposit.id;
      found.payeeName = String(payee.display_name || found.payeeName || method.accountName);
      found.payeePhone = String(payee.msisdn || found.payeePhone || method.accountNumber);
      found.qrPngBase64 = deposit.qr_png_base64 || null;
      found.qrPayload = deposit.qr_payload || null;
      return found;
    });

    return Response.json({
      order,
      payee: {
        name: order.payeeName,
        phone: order.payeePhone,
        method: method.method,
        qrPngBase64: order.qrPngBase64,
        qrPayload: order.qrPayload,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
