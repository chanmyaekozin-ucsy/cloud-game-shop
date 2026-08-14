import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET() {
  try {
    await requireAdmin();
    const store = await readStore();
    const games = [...store.games].sort((a, b) => a.sortOrder - b.sortOrder);
    return Response.json({ games });
  } catch (err) {
    return jsonError(err);
  }
}
