import { jsonError, requireUser } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const store = await readStore();
    const found = store.orders.find((o) => o.id === id);
    if (!found || (found.userId !== session.sub && session.role !== "admin")) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }
    const game = store.games.find((g) => g.id === found.gameId);
    return Response.json({ order: found, gameSlug: game?.slug ?? null });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const order = await updateStore((store) => {
      const found = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!found) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (found.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order can no longer be cancelled."), { status: 409 });
      }
      found.status = "cancelled";
      found.completedAt = new Date().toISOString();
      return found;
    });
    return Response.json({ order });
  } catch (err) {
    return jsonError(err);
  }
}
