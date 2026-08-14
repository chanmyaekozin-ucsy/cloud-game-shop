import { jsonError } from "@/lib/auth";
import { getGameById, toGameRecord } from "@/games/shared/catalog";
import { readStore } from "@/lib/store";

export async function GET() {
  try {
    const store = await readStore();
    const games = store.games
      .filter((g) => g.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => {
        const mod = getGameById(row.id);
        if (!mod) return row;
        return {
          ...toGameRecord(mod),
          ...row,
          fields: mod.fields,
          packageLabel: mod.packageLabel,
        };
      });
    return Response.json({ games });
  } catch (err) {
    return jsonError(err);
  }
}
