import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const MAX_RATE_LIMIT_KEYS = 10000;
const rateLimitStore = new Map<string, RateLimitRecord>();

function sanitizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (/^[a-fA-F0-9:.]+$/.test(clean) && clean.length <= 45) {
    return clean;
  }
  return null;
}

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (record.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const cfConnectingIp = sanitizeIp(headers.get("cf-connecting-ip"));
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = sanitizeIp(headers.get("x-real-ip"));
  if (xRealIp) return xRealIp;

  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = sanitizeIp(xForwardedFor.split(",")[0]);
    if (first) return first;
  }

  return "127.0.0.1";
}

/**
 * Check if a request exceeds rate limit.
 * @param key Unique key for the rate limit bucket (e.g. `login:192.168.1.1` or `userId:order`)
 * @param limit Maximum allowed requests in the window
 * @param windowMs Window duration in milliseconds
 * @returns `{ ok: boolean; remaining: number; resetAt: number }`
 */
export function checkRateLimit(
  key: string,
  limit: number = 10,
  windowMs: number = 60 * 1000,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    if (rateLimitStore.size >= MAX_RATE_LIMIT_KEYS) {
      for (const [k, rec] of rateLimitStore.entries()) {
        if (rec.resetAt <= now) rateLimitStore.delete(k);
      }
      if (rateLimitStore.size >= MAX_RATE_LIMIT_KEYS) {
        let dropped = 0;
        for (const k of rateLimitStore.keys()) {
          rateLimitStore.delete(k);
          if (++dropped >= 500) break;
        }
      }
    }

    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function rateLimitResponse(resetAt: number) {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests. Please slow down and try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Reset": String(resetAt),
      },
    },
  );
}
