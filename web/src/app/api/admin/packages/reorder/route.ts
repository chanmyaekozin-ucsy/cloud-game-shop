import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { gameId?: string; ids?: string[] };
    const gameId = String(body.gameId ?? "");
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!gameId || ids.length === 0) {
      return Response.json({ error: "Missing package order." }, { status: 400 });
    }
    const packages = await updateStore((store) => {
      const wanted = new Set(
        store.packages.filter((p) => p.gameId === gameId).map((p) => p.id),
      );
      if (ids.length !== wanted.size || ids.some((id) => !wanted.has(id))) {
        throw Object.assign(new Error("Package list does not match this game."), { status: 400 });
      }
      ids.forEach((id, index) => {
        const found = store.packages.find((p) => p.id === id);
        if (found) found.sortOrder = index;
      });
      return store.packages
        .filter((p) => p.gameId === gameId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    });
    return Response.json({ packages });
  } catch (err) {
    return jsonError(err);
  }
}
