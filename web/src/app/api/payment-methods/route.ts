import { jsonError } from "@/lib/auth";
import { listPaymentMethods } from "@/lib/dominate";

export async function GET() {
  try {
    const methods = await listPaymentMethods();
    return Response.json({ methods, configured: methods.length > 0 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
