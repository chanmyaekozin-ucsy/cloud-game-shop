import { jsonError, requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/store";
import { getSmileSupplierStatus, updateSmileSession } from "@/lib/smileone";

export async function GET() {
  try {
    await requireAdmin();
    const supplier = await getSmileSupplierStatus();
    return Response.json({ supplier });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      phpsessid?: string;
      cookieHeader?: string;
      region?: string;
    };
    const result = await updateSmileSession(body);
    audit(session.sub, "supplier.session_update", {
      ok: result.ok,
      providedCookieHeader: Boolean(body.cookieHeader),
      providedPhpsessid: Boolean(body.phpsessid),
      region: body.region ?? null,
    });
    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
