import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role, Session } from "./types";

const COOKIE = "cgs_session";

let warnedSecret = false;

function secret() {
  const raw = process.env.AUTH_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production" && !warnedSecret) {
      console.warn(
        "[SECURITY WARNING] AUTH_SECRET is not set! Using default secret in production is insecure. Set AUTH_SECRET in your environment.",
      );
      warnedSecret = true;
    }
    return new TextEncoder().encode("cloud-game-shop-dev-secret");
  }
  return new TextEncoder().encode(raw);
}

export async function signSession(session: Session) {
  return new SignJWT({ role: session.role, name: session.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret());
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sub = String(payload.sub ?? "");
    const role = payload.role === "admin" ? "admin" : "user";
    const name = String(payload.name ?? "");
    if (!sub) return null;
    return { sub, role: role as Role, name };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: Session) {
  const token = await signSession(session);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function requireUser() {
  const session = await readSession();
  if (!session) {
    const err = new Error("Sign in required");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.role !== "admin") {
    const err = new Error("Admin only");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return session;
}

export function jsonError(err: unknown, fallback = 400) {
  const status =
    typeof err === "object" && err && "status" in err
      ? Number((err as { status: number }).status)
      : fallback;
  const message = err instanceof Error ? err.message : "Request failed";
  return Response.json({ error: message }, { status: Number.isFinite(status) ? status : fallback });
}
