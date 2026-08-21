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
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid game ID format." }, { status: 400 });
    }

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

    const bytes = Buffer.from(await file.arrayBuffer());

    // Validate magic bytes to prevent masqueraded files
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";

    if (!isPng && !isJpg && !isWebp) {
      return Response.json({ error: "Invalid image file format." }, { status: 400 });
    }

    const baseDir = path.resolve(DIR);
    await mkdir(baseDir, { recursive: true });
    const filename = `${id}.${ext}`;
    const targetPath = path.resolve(baseDir, filename);

    if (!targetPath.startsWith(baseDir)) {
      return Response.json({ error: "Invalid target path." }, { status: 400 });
    }

    await writeFile(targetPath, bytes);
    await Promise.all(
      Object.values(TYPES)
        .filter((other) => other !== ext)
        .map((other) => {
          const p = path.resolve(baseDir, `${id}.${other}`);
          return p.startsWith(baseDir) ? unlink(p).catch(() => undefined) : undefined;
        }),
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
