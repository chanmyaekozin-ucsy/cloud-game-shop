import { readFile } from "fs/promises";
import path from "path";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!/^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const baseDir = path.resolve(process.cwd(), "data", "uploads", "games");
  const targetPath = path.resolve(baseDir, file);

  if (!targetPath.startsWith(baseDir)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const buf = await readFile(targetPath);
    const ext = file.split(".").pop()?.toLowerCase() ?? "png";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
