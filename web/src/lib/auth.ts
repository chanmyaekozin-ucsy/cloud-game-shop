import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role, Session } from "./types";

const COOKIE = "cgs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

let cachedKey: Uint8Array | null = null;
let cachedRaw = "";

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET || "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedKey = new TextEncoder().encode(raw);
  }
  return cachedKey!;
}

export function assertAuthSecretConfigured() {
  if (!process.env.AUTH_SECRET) {
    throw new Error(
      "[CONFIG] AUTH_SECRET is not set. Refusing to run: sessions cannot be signed securely. Generate one with `openssl rand -base64 48`.",
    );
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function signSession(session: Session & { ver?: number }) {
  assertAuthSecretConfigured();
  return new SignJWT({ role: session.role, name: session.name, ver: session.ver })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function readSession(tokenVersion?: number): Promise<Session | null> {
  if (isProduction()) {
    assertAuthSecretConfigured();
  }
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sub = String(payload.sub ?? "");
    const role = payload.role === "admin" ? "admin" : "user";
    const name = String(payload.name ?? "");
    if (!sub) return null;
    // Reject tokens issued before the user's current tokenVersion (revocation).
    if (
      typeof tokenVersion === "number" &&
      typeof payload.ver === "number" &&
      payload.ver < tokenVersion
    ) {
      return null;
    }
    return { sub, role: role as Role, name };
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: Session & { ver?: number }) {
  const token = await signSession(session);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
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
  const isProd = process.env.NODE_ENV === "production";
  const rawMessage = err instanceof Error ? err.message : "Request failed";

  const message =
    isProd && status >= 500
      ? "An internal server error occurred. Please try again later."
      : rawMessage;

  if (status >= 500) {
    console.error("[ServerError]", err);
  }

  return Response.json({ error: message }, { status: Number.isFinite(status) ? status : fallback });
}
