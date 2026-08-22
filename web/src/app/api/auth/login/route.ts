import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore, updateStore } from "@/lib/store";
import { verifyTotpCounter } from "@/lib/totp";

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
    if (!user) {
      return Response.json({ error: "Wrong credentials. Please try again." }, { status: 401 });
    }

    if (!user.pinHash.startsWith("scrypt:")) {
      // Hash format predates the scrypt migration and is no longer verifiable.
      console.error(`[AUTH] User ${user.id} has a non-scrypt pinHash; password reset required.`);
      return Response.json(
        { error: "This account must reset its password before signing in. Contact support." },
        { status: 403 },
      );
    }

    if (!verifyPassword(secret, user.pinHash)) {
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

      const matchedCounter = verifyTotpCounter(totpCode, user.twoFactorSecret);
      if (matchedCounter === null) {
        return Response.json(
          { error: "Invalid 6-digit authenticator code. Please try again." },
          { status: 401 },
        );
      }

      // Replay protection: reject codes from counters already consumed.
      const lastUsed = user.lastUsedTotpCounter ?? 0;
      if (matchedCounter <= lastUsed) {
        return Response.json(
          { error: "This code was already used. Wait for the next code and try again." },
          { status: 401 },
        );
      }

      await updateStore((s) => {
        const u = s.users.find((item) => item.id === user.id);
        if (u) u.lastUsedTotpCounter = matchedCounter;
        return u;
      });
    }

    await setSessionCookie({
      sub: user.id,
      role: user.role,
      name: user.name,
      ver: user.tokenVersion ?? 0,
    });
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
