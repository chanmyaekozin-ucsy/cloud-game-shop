import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { updateStore } from "@/lib/store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as Partial<{
      displayName: string;
      priceKs: number;
      offPercent: number;
      offKs: number;
      smileGoodsId: string;
      smileCoin: number;
      featured: boolean;
      isActive: boolean;
    }>;
    const pkg = await updateStore((store) => {
      const found = store.packages.find((p) => p.id === id);
      if (!found) throw Object.assign(new Error("Package not found."), { status: 404 });
      if (typeof body.displayName === "string" && body.displayName.trim()) {
        found.displayName = body.displayName.trim();
      }
      if (typeof body.priceKs === "number") found.priceKs = Math.max(0, Math.round(body.priceKs));
      if (typeof body.offPercent === "number") {
        found.offPercent = Math.min(100, Math.max(0, Math.round(body.offPercent)));
      }
      if (typeof body.offKs === "number") found.offKs = Math.max(0, Math.round(body.offKs));
      if (typeof body.smileGoodsId === "string") found.smileGoodsId = body.smileGoodsId.trim();
      if (typeof body.smileCoin === "number") found.smileCoin = Math.max(0, body.smileCoin);
      if (typeof body.featured === "boolean") found.featured = body.featured;
      if (typeof body.isActive === "boolean") found.isActive = body.isActive;
      return found;
    });
    return Response.json({ package: pkg });
  } catch (err) {
    return jsonError(err);
  }
}
