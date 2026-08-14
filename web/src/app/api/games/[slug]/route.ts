import { jsonError } from "@/lib/auth";
import { getGame, toGameRecord } from "@/games/shared/catalog";
import { readStore } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const mod = getGame(slug);
    const store = await readStore();
    const row = store.games.find((g) => g.slug === slug && g.isActive);
    if (!mod || !row) return Response.json({ error: "Game not found." }, { status: 404 });
    const game = { ...toGameRecord(mod), ...row, fields: mod.fields, packageLabel: mod.packageLabel };
    const packages = store.packages
      .filter((p) => p.gameId === row.id && p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return Response.json({ game, packages });
  } catch (err) {
    return jsonError(err);
  }
}
