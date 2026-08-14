import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const status = req.nextUrl.searchParams.get("status") || "";
    const store = await readStore();
    const users = new Map(store.users.map((u) => [u.id, u]));
    let rows = [...store.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (status) rows = rows.filter((t) => t.status === status);
    if (q) {
      rows = rows.filter((t) =>
        [t.id, t.txid, t.orderId, users.get(t.userId)?.name, users.get(t.userId)?.phone]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return Response.json({
      transactions: rows.map((t) => ({
        ...t,
        user: {
          name: users.get(t.userId)?.name ?? "",
          phone: users.get(t.userId)?.phone ?? "",
        },
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}
