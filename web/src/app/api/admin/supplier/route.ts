import { jsonError, requireAdmin } from "@/lib/auth";
import { getSmileSupplierStatus } from "@/lib/smileone";

export async function GET() {
  try {
    await requireAdmin();
    const supplier = await getSmileSupplierStatus();
    return Response.json({ supplier });
  } catch (err) {
    return jsonError(err);
  }
}
