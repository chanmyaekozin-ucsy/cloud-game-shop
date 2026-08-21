import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore } from "@/lib/store";
import { verifyTotp } from "@/lib/totp";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`login:${ip}`, 5, 60 * 1000);
    if (!rl.ok) {
      return rateLimitResponse(rl.resetAt);
    }

    const body = (await req.json()) as {
      identifier?: string;
      pin?: string;
      password?: string;
      totpCode?: string;
    };
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const secret = String(body.password ?? body.pin ?? "").trim();
    const totpCode = String(body.totpCode ?? "").trim();

    if (!identifier || !secret) {
      return Response.json({ error: "Email or phone, and password required." }, { status: 400 });
    }
    const store = await readStore();
    const user = store.users.find(
      (u) =>
        u.phone.replace(/\s/g, "") === identifier.replace(/\s/g, "") ||
        u.email.toLowerCase() === identifier,
    );
    if (!user || user.pinHash !== hashPassword(secret)) {
      return Response.json({ error: "Wrong credentials. Please try again." }, { status: 401 });
    }

    // Check 2FA if enabled
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!totpCode) {
        return Response.json({
          requires2FA: true,
          message: "Please enter your 6-digit Google Authenticator code.",
        });
      }

      const isValid = verifyTotp(totpCode, user.twoFactorSecret);
      if (!isValid) {
        return Response.json(
          { error: "Invalid 6-digit authenticator code. Please try again." },
          { status: 401 },
        );
      }
    }

    await setSessionCookie({ sub: user.id, role: user.role, name: user.name });
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        balanceKs: user.balanceKs,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
