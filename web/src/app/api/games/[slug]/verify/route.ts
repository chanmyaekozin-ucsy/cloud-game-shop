import { NextRequest } from "next/server";
import { jsonError } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { getGame } from "@/games/shared/catalog";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`game_verify:${ip}`, 20, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const { slug } = await params;
    const game = getGame(slug);
    if (!game) return Response.json({ error: "Game not found." }, { status: 404 });
    const body = (await req.json()) as { gameUserId?: string; zoneId?: string };
    const account = await game.verify({
      gameUserId: String(body.gameUserId ?? ""),
      zoneId: String(body.zoneId ?? ""),
    });
    return Response.json({ account });
  } catch (err) {
    return jsonError(err, 404);
  }
}
