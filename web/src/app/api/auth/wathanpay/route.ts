import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin, hashToken } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wp:${ip}`, 20, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json()) as { accessToken?: string };
    const token = String(body.accessToken ?? "").trim();
    if (!token) {
      return Response.json({ error: "Missing WathanPay token." }, { status: 401 });
    }
    const sub = `wp_${hashToken(token)}`;
    const isProd = process.env.NODE_ENV === "production";
    const user = await updateStore((store) => {
      let found = store.users.find((u) => u.wathanpaySub === sub || u.id === sub);
      if (!found) {
        found = {
          id: sub,
          name: "WathanPay",
          phone: "",
          email: "",
          role: "user",
          pinHash: hashPin(token.slice(-6).padStart(6, "0")),
          balanceKs: isProd ? 0 : 250000,
          wathanpaySub: sub,
        };
        store.users.push(found);
      }
      return found;
    });
    await setSessionCookie({ sub: user.id, role: user.role, name: user.name });
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        balanceKs: user.balanceKs,
        miniApp: true,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
