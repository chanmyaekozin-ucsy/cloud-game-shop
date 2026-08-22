import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin, hashToken } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import type { MiniAppUser } from "@/types/wathanpay";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wp:${ip}`, 30, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json().catch(() => ({}))) as {
      accessToken?: string;
      user?: MiniAppUser;
    };

    const token = String(body.accessToken ?? "").trim();
    const wpUser = body.user;

    let sub = "";
    if (wpUser?.id && String(wpUser.id).trim().length > 0) {
      const sanitizedId = String(wpUser.id).trim().replace(/[^a-zA-Z0-9_-]/g, "");
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

    const isProd = process.env.NODE_ENV === "production";
    const userName = (wpUser?.name && String(wpUser.name).trim()) || "WathanPay User";
    const userPhone = (wpUser?.phone && String(wpUser.phone).trim()) || "";
    const userAvatar = wpUser?.avatarUrl || null;

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
        // Update user profile info if newly shared
        if (userName && userName !== "WathanPay User" && (!found.name || found.name === "WathanPay" || found.name === "WathanPay User")) {
          found.name = userName;
        }
        if (userPhone && !found.phone) {
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
