import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin } from "@/lib/hash";
import { readStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { identifier?: string; pin?: string };
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "").trim();
    if (!identifier || pin.length !== 6) {
      return Response.json({ error: "Phone/email and 6-digit PIN required." }, { status: 400 });
    }
    const store = await readStore();
    const user = store.users.find(
      (u) =>
        u.phone.replace(/\s/g, "") === identifier.replace(/\s/g, "") ||
        u.email.toLowerCase() === identifier,
    );
    if (!user || user.pinHash !== hashPin(pin)) {
      return Response.json({ error: "Wrong phone, email, or PIN." }, { status: 401 });
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
