import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { audit, readStore, updateStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const gameId = req.nextUrl.searchParams.get("gameId");
    const store = await readStore();
    const packages = store.packages
      .filter((p) => !gameId || p.gameId === gameId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return Response.json({ packages });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = (await req.json()) as {
      gameId?: string;
      name?: string;
      displayName?: string;
      priceKs?: number;
      smileGoodsId?: string;
      smileCoin?: number;
      featured?: boolean;
      isActive?: boolean;
    };
    const pkg = await updateStore((store) => {
      const game = store.games.find((g) => g.id === body.gameId);
      if (!game) throw Object.assign(new Error("Game not found."), { status: 404 });
      const created = {
        id: `pkg_${Date.now().toString(36)}`,
        gameId: game.id,
        name: String(body.name ?? "").trim() || "Package",
        displayName: String(body.displayName ?? body.name ?? "Package").trim(),
        priceKs: Math.round(Number(body.priceKs) || 0),
        offPercent: 0,
        offKs: 0,
        smileGoodsId: String(body.smileGoodsId ?? "").trim(),
        smileCoin: Number(body.smileCoin) || 0,
        featured: Boolean(body.featured),
        isActive: body.isActive !== false,
        sortOrder: store.packages.filter((p) => p.gameId === game.id).length,
      };
      store.packages.push(created);
      audit(session.sub, "package.create", {
        packageId: created.id,
        gameId: game.id,
        priceKs: created.priceKs,
      });
      return created;
    });
    return Response.json({ package: pkg });
  } catch (err) {
    return jsonError(err);
  }
}
