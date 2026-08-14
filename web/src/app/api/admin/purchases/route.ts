import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const status = req.nextUrl.searchParams.get("status") || "";
    const paidBy = (req.nextUrl.searchParams.get("paidBy") || "").trim().toLowerCase();
    const store = await readStore();
    let rows = [...store.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (status) rows = rows.filter((o) => o.status === status);
    if (paidBy) {
      rows = rows.filter((o) => o.paymentMethod.toLowerCase().includes(paidBy));
    }
    if (q) {
      rows = rows.filter((o) =>
        [o.id, o.nickname, o.gameUserId, o.zoneId, o.packageName, o.gameName, o.txid, o.paymentMethod]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return Response.json({ orders: rows });
  } catch (err) {
    return jsonError(err);
  }
}
