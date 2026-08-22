import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin, hashToken } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import { verifyWathanPayAuth } from "@/lib/wathanpay";
import type { MiniAppUser } from "@/types/wathanpay";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wp:${ip}`, 30, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json().catch(() => ({}))) as {
      authData?: string;
      accessToken?: string;
      user?: MiniAppUser;
    };

    const authDataStr = String(body.authData ?? "").trim();
    const token = String(body.accessToken ?? "").trim();
    const clientUser = body.user;

    let verifiedUser: {
      id: string;
      name: string;
      phone?: string;
      maskedPhone?: string;
      avatarUrl?: string | null;
    } | null = null;

    if (authDataStr) {
      const authVerification = verifyWathanPayAuth(authDataStr);
      if (!authVerification.ok || !authVerification.user) {
        return Response.json(
          { error: authVerification.error || "Cryptographic authData verification failed." },
          { status: 401 }
        );
      }
      verifiedUser = authVerification.user;
    }

    const secretConfigured = Boolean(
      process.env.WATHANPAY_MERCHANT_SECRET ||
      process.env.WATHANPAY_SECRET_KEY ||
      process.env.WATHANPAY_API_KEY
    );
    const isProd = process.env.NODE_ENV === "production";

    // In production with merchant secret configured, require cryptographic authData
    if (!verifiedUser && isProd && secretConfigured) {
      return Response.json(
        { error: "Cryptographic authData is required to authenticate WathanPay session." },
        { status: 401 }
      );
    }

    const rawId = verifiedUser?.id || clientUser?.id;
    let sub = "";
    if (rawId && String(rawId).trim().length > 0) {
      const sanitizedId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, "");
      sub = `wp_${sanitizedId}`;
    } else if (token && token.length >= 8 && token.length <= 512) {
      sub = `wp_${hashToken(token)}`;
    }

    if (!sub) {
      return Response.json(
        { error: "Invalid or missing WathanPay user profile / token." },
        { status: 401 }
      );
    }

    const userName =
      (verifiedUser?.name && String(verifiedUser.name).trim()) ||
      (clientUser?.name && String(clientUser.name).trim()) ||
      "WathanPay User";
    const userPhone =
      (verifiedUser?.maskedPhone && String(verifiedUser.maskedPhone).trim()) ||
      (verifiedUser?.phone && String(verifiedUser.phone).trim()) ||
      (clientUser?.maskedPhone && String(clientUser.maskedPhone).trim()) ||
      (clientUser?.phone && String(clientUser.phone).trim()) ||
      "";
    const userAvatar = verifiedUser?.avatarUrl || clientUser?.avatarUrl || null;

    const user = await updateStore((store) => {
      let found = store.users.find((u) => u.wathanpaySub === sub || u.id === sub);
      if (!found) {
        found = {
          id: sub,
          name: userName,
          phone: userPhone,
          email: "",
          role: "user",
          pinHash: hashPin(token ? token.slice(-6).padStart(6, "0") : "123456"),
          balanceKs: isProd ? 0 : 250000,
          wathanpaySub: sub,
          avatarUrl: userAvatar,
        };
        store.users.push(found);
      } else {
        // Update user profile info if newly shared or updated
        if (
          userName &&
          userName !== "WathanPay User" &&
          (!found.name || found.name === "WathanPay" || found.name === "WathanPay User")
        ) {
          found.name = userName;
        }
        if (userPhone && (!found.phone || found.phone !== userPhone)) {
          found.phone = userPhone;
        }
        if (userAvatar && !found.avatarUrl) {
          found.avatarUrl = userAvatar;
        }
      }
      return found;
    });

    await setSessionCookie({ sub: user.id, role: user.role, name: user.name });

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
