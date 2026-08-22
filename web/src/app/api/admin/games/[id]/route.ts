import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { audit, updateStore } from "@/lib/store";
import type { GameTag } from "@/lib/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as Partial<{
      name: string;
      tag: GameTag;
      isActive: boolean;
      sortOrder: number;
      needsVerify: boolean;
      idLabel: string;
      zoneLabel: string;
    }>;
    const game = await updateStore((store) => {
      const found = store.games.find((g) => g.id === id);
      if (!found) throw Object.assign(new Error("Game not found."), { status: 404 });
      if (typeof body.name === "string" && body.name.trim()) found.name = body.name.trim();
      if (body.tag === "hot" || body.tag === "promo" || body.tag === null) found.tag = body.tag;
      if (typeof body.isActive === "boolean") found.isActive = body.isActive;
      if (typeof body.sortOrder === "number") found.sortOrder = body.sortOrder;
      if (typeof body.needsVerify === "boolean") found.needsVerify = body.needsVerify;
      if (typeof body.idLabel === "string") found.idLabel = body.idLabel;
      if (typeof body.zoneLabel === "string") found.zoneLabel = body.zoneLabel;
      return found;
    });
    audit(session.sub, "game.update", { gameId: id, changes: body });
    return Response.json({ game });
  } catch (err) {
    return jsonError(err);
  }
}
