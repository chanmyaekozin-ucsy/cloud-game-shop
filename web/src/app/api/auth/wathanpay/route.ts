import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin } from "@/lib/hash";
import { randomBytes } from "crypto";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import { verifyWathanPayAuth } from "@/lib/wathanpay";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wp:${ip}`, 30, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json().catch(() => ({}))) as {
      authData?: string;
    };

    const authDataStr = String(body.authData ?? "").trim();

    // Cryptographically verified authData is the only accepted credential.
    // Client-supplied user profiles and access tokens are never trusted.
    const authVerification = verifyWathanPayAuth(authDataStr);
    if (!authVerification.ok || !authVerification.user) {
      return Response.json(
        { error: authVerification.error || "Cryptographic authData verification failed." },
        { status: 401 }
      );
    }

    const verifiedUser = authVerification.user;
    const sanitizedId = String(verifiedUser.id).trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitizedId) {
      return Response.json(
        { error: "Invalid WathanPay user profile." },
        { status: 401 }
      );
    }
    const sub = `wp_${sanitizedId}`;

    // New accounts get an unguessable random PIN hash: nobody can log in via
    // /api/auth/login with a guessed password. Wallet login is the only path.
    const activationSecret = hashPin(randomBytes(24).toString("base64url"));

    const userPhone =
      (verifiedUser.maskedPhone && String(verifiedUser.maskedPhone).trim()) ||
      (verifiedUser.phone && String(verifiedUser.phone).trim()) ||
      "";
    const userName =
      (verifiedUser.name && String(verifiedUser.name).trim()) || "WathanPay User";

    const user = await updateStore((store) => {
      let found = store.users.find((u) => u.wathanpaySub === sub || u.id === sub);
      if (!found) {
        found = {
          id: sub,
          name: userName,
          phone: userPhone,
          email: "",
          role: "user",
          pinHash: activationSecret,
          balanceKs: 0,
          wathanpaySub: sub,
          avatarUrl: verifiedUser.avatarUrl ?? null,
        };
        store.users.push(found);
      } else {
        if (
          userName &&
          userName !== "WathanPay User" &&
          (!found.name || found.name === "WathanPay" || found.name === "WathanPay User")
        ) {
          found.name = userName;
        }
        if (userPhone && found.phone !== userPhone) {
          found.phone = userPhone;
        }
        if (verifiedUser.avatarUrl && !found.avatarUrl) {
          found.avatarUrl = verifiedUser.avatarUrl;
        }
      }
      return found;
    });

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
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
        balanceKs: user.balanceKs,
        miniApp: true,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
