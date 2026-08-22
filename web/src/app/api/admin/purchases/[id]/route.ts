import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { paySmileoneMlbb } from "@/lib/smileone";
import { audit, readStore, updateStore } from "@/lib/store";

type Action = "decline" | "approve" | "already_approve";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action ?? "").trim() as Action;

    if (action !== "decline" && action !== "approve" && action !== "already_approve") {
      return Response.json(
        { error: "action must be decline, approve, or already_approve." },
        { status: 400 },
      );
    }

    if (action === "approve") {
      // Read outside the write lock, call Smile.one, then commit status.
      const store = await readStore();
      const existing = store.orders.find((o) => o.id === id);
      if (!existing) {
        return Response.json({ error: "Order not found." }, { status: 404 });
      }
      if (existing.status !== "processing") {
        return Response.json({ error: "Only processing orders can be approved." }, { status: 409 });
      }
      const pkg = store.packages.find((p) => p.id === existing.packageId);
      const smileGoodsId = pkg?.smileGoodsId ?? "";
      if (!smileGoodsId) {
        return Response.json(
          { error: "This package has no Smile.one goods ID. Use Already Approve after manual delivery." },
          { status: 400 },
        );
      }

      const topup = await paySmileoneMlbb({
        gameUserId: existing.gameUserId,
        zoneId: existing.zoneId,
        smileGoodsId,
      });

      if (!topup.ok) {
        await updateStore((s) => {
          const order = s.orders.find((o) => o.id === id);
          if (order && order.status === "processing") {
            order.failReason = `Admin approve failed: ${topup.message}`;
          }
          return order;
        });
        audit(session.sub, "purchase.approve_failed", {
          orderId: id,
          message: topup.message,
        });
        return Response.json(
          { error: `Smile.one top-up failed: ${topup.message}` },
          { status: 502 },
        );
      }

      const order = await updateStore((s) => {
        const found = s.orders.find((o) => o.id === id);
        if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
        if (found.status !== "processing") {
          throw Object.assign(new Error("Order is no longer processing."), { status: 409 });
        }
        found.status = "success";
        found.failReason = null;
        found.completedAt = new Date().toISOString();
        return found;
      });

      audit(session.sub, "purchase.approve", { orderId: id, smileGoodsId });
      return Response.json({ order, message: "Package delivered and marked completed." });
    }

    const order = await updateStore((store) => {
      const found = store.orders.find((o) => o.id === id);
      if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (found.status !== "processing") {
        throw Object.assign(
          new Error("Only processing orders can be updated this way."),
          { status: 409 },
        );
      }

      if (action === "decline") {
        found.status = "failed";
        found.failReason = "Declined by admin";
        found.completedAt = new Date().toISOString();
      } else {
        // already_approve — mark completed without calling Smile.one
        found.status = "success";
        found.failReason = null;
        found.completedAt = new Date().toISOString();
      }
      return found;
    });

    audit(session.sub, action === "decline" ? "purchase.decline" : "purchase.already_approve", {
      orderId: id,
    });

    return Response.json({
      order,
      message:
        action === "decline"
          ? "Order marked as failed."
          : "Order marked as completed.",
    });
  } catch (err) {
    return jsonError(err);
  }
}
