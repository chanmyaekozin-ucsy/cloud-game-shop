import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";
import { generateTotpSecret, generateQrSvg, getOtpAuthUrl, verifyTotpCounter } from "@/lib/totp";

export async function GET() {
  try {
    const session = await requireAdmin();
    const store = await readStore();
    const user = store.users.find((u) => u.id === session.sub);
    if (!user) {
      return Response.json({ error: "User not found." }, { status: 404 });
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      return Response.json({
        enabled: true,
      });
    }

    // Generate new secret & QR code for setup. The secret is NOT persisted
    // here; it is only bound to the account after a valid code proves the
    // user actually scanned it (POST below). This prevents planting a
    // known secret.
    const secret = generateTotpSecret(20);
    const otpauthUrl = getOtpAuthUrl(secret, user.email || "admin@cloudgameshop.com", "Cloud Game Shop");
    const qrCodeSvg = await generateQrSvg(otpauthUrl, 220);

    return Response.json({
      enabled: false,
      secret,
      otpauthUrl,
      qrCodeSvg,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = (await req.json()) as { code?: string; secret?: string };
    const code = String(body.code ?? "").trim();
    const secret = String(body.secret ?? "").trim();

    if (!code || !secret) {
      return Response.json({ error: "Verification code and secret are required." }, { status: 400 });
    }

    const matchedCounter = verifyTotpCounter(code, secret);
    if (matchedCounter === null) {
      return Response.json(
        { error: "Invalid 6-digit code. Ensure your device time is accurate and try again." },
        { status: 400 },
      );
    }

    await updateStore((store) => {
      const user = store.users.find((u) => u.id === session.sub);
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
      user.twoFactorSecret = secret;
      user.twoFactorEnabled = true;
      user.lastUsedTotpCounter = matchedCounter;
      return user;
    });

    return Response.json({
      ok: true,
      message: "Two-Factor Authentication is now enabled for your account.",
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = (await req.json()) as { code?: string };
    const code = String(body.code ?? "").trim();

    if (!code) {
      return Response.json({ error: "Enter the current 6-digit code to disable 2FA." }, { status: 400 });
    }

    const store = await readStore();
    const user = store.users.find((u) => u.id === session.sub);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return Response.json({ error: "2FA is not currently enabled." }, { status: 400 });
    }

    const matchedCounter = verifyTotpCounter(code, user.twoFactorSecret);
    if (matchedCounter === null) {
      return Response.json({ error: "Invalid 6-digit code. 2FA was not disabled." }, { status: 400 });
    }
    const lastUsed = user.lastUsedTotpCounter ?? 0;
    if (matchedCounter <= lastUsed) {
      return Response.json(
        { error: "This code was already used. Wait for the next code and try again." },
        { status: 400 },
      );
    }

    await updateStore((s) => {
      const u = s.users.find((userItem) => userItem.id === session.sub);
      if (u) {
        u.twoFactorEnabled = false;
        u.twoFactorSecret = null;
        u.lastUsedTotpCounter = matchedCounter;
        // Revoke existing sessions so a stolen pre-disable cookie cannot
        // keep admin access after 2FA was removed.
        u.tokenVersion = (u.tokenVersion ?? 0) + 1;
      }
      return u;
    });

    return Response.json({
      ok: true,
      message: "Two-Factor Authentication has been disabled. Please sign in again.",
    });
  } catch (err) {
    return jsonError(err);
  }
}
