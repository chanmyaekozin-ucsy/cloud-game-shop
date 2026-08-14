import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { updateStore } from "@/lib/store";

const DIR = path.join(process.cwd(), "data", "uploads", "games");
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX = 2 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "Choose an image." }, { status: 400 });
    }
    if (file.size > MAX) {
      return Response.json({ error: "Image must be under 2 MB." }, { status: 400 });
    }
    const ext = TYPES[file.type];
    if (!ext) {
      return Response.json({ error: "Use PNG, JPG, or WebP." }, { status: 400 });
    }

    await mkdir(DIR, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = `${id}.${ext}`;
    await writeFile(path.join(DIR, filename), bytes);
    await Promise.all(
      Object.values(TYPES)
        .filter((other) => other !== ext)
        .map((other) => unlink(path.join(DIR, `${id}.${other}`)).catch(() => undefined)),
    );

    const icon = `/uploads/games/${filename}?v=${Date.now()}`;
    const game = await updateStore((store) => {
      const found = store.games.find((g) => g.id === id);
      if (!found) throw Object.assign(new Error("Game not found."), { status: 404 });
      found.icon = icon;
      return found;
    });
    return Response.json({ game });
  } catch (err) {
    return jsonError(err);
  }
}
