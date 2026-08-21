import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { salePriceKs } from "@/lib/format";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore, updateStore } from "@/lib/store";
import { validateSmileonePackageAvailability } from "@/lib/smileone";
import type { Order } from "@/lib/types";

export async function GET() {
  try {
    const session = await requireUser();
    const store = await readStore();
    const orders = store.orders
      .filter((o) => o.userId === session.sub)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Response.json({ orders });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const ip = getClientIp(req);

    const rl = checkRateLimit(`order_create:${session.sub || ip}`, 15, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json()) as {
      gameId?: string;
      packageId?: string;
      gameUserId?: string;
      zoneId?: string;
      nickname?: string;
      region?: string;
    };

    const preview = await readStore();
    const game = preview.games.find((g) => g.id === body.gameId && g.isActive);
    const pkg = preview.packages.find(
      (p) => p.id === body.packageId && p.gameId === game?.id && p.isActive,
    );
    if (!game || !pkg) {
      return Response.json({ error: "Package not found." }, { status: 404 });
    }

    const check = await validateSmileonePackageAvailability(pkg);
    if (!check.ok) {
      return Response.json({ error: check.error }, { status: 400 });
    }

    const order = await updateStore((store) => {
      const user = store.users.find((u) => u.id === session.sub);
      if (!user) {
        throw Object.assign(new Error("User not found."), { status: 401 });
      }
      const open = store.orders.find(
        (o) =>
          o.userId === user.id &&
          (o.status === "awaiting_payment" || o.status === "processing" || o.status === "paid"),
      );
      if (open?.status === "awaiting_payment") {
        open.status = "cancelled";
        open.completedAt = new Date().toISOString();
      } else if (open) {
        throw Object.assign(
          new Error("You already have an open order. Finish or cancel it first."),
          { status: 409 },
        );
      }
      const game = store.games.find((g) => g.id === body.gameId && g.isActive);
      const pkg = store.packages.find(
        (p) => p.id === body.packageId && p.gameId === game?.id && p.isActive,
      );
      if (!game || !pkg) {
        throw Object.assign(new Error("Package not found."), { status: 404 });
      }
      const created: Order = {
        id: `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        userId: user.id,
        gameId: game.id,
        gameName: game.name,
        packageId: pkg.id,
        packageName: pkg.displayName,
        amountKs: salePriceKs(pkg),
        gameUserId: String(body.gameUserId ?? "").trim(),
        zoneId: String(body.zoneId ?? "").trim(),
        nickname: String(body.nickname ?? "").trim(),
        region: String(body.region ?? "").trim(),
        status: "awaiting_payment",
        paymentMethod: "",
        depositId: null,
        payeeName: null,
        payeePhone: null,
        txid: null,
        failReason: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      store.orders.push(created);
      return created;
    });
    return Response.json({ order });
  } catch (err) {
    return jsonError(err);
  }
}
