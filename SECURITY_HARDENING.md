# Production Security Hardening Guidelines & Checklist

This document provides a universal security hardening standard for Next.js, Node.js, and web application projects prior to public production deployment.

---

## 1. HTTP Security Headers & Content Security Policy (CSP)

Add the following security headers in `next.config.ts` (or Express / reverse proxy configuration):

```typescript
// next.config.ts
import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN", // Use 'DENY' if not embedding in iframes / mini-apps
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://*.telegram.org",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.wathanpay.com https://*.smile.one",
      "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

---

## 2. Session Cookies & Secrets Management

### Session Cookie Rules
- Always enable `httpOnly: true` (prevents JavaScript/XSS cookie access).
- Always enable `sameSite: "lax"` (or `"strict"`) to mitigate Cross-Site Request Forgery (CSRF).
- Always enable `secure: process.env.NODE_ENV === "production"` (only transmits over HTTPS in production).

```typescript
// src/lib/auth.ts
export async function setSessionCookie(token: string) {
  (await cookies()).set("session_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 days
    secure: process.env.NODE_ENV === "production",
  });
}
```

### Secrets & Fallbacks
- Never fall back to default development strings in production without alerting or failing early.
```typescript
function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[SECURITY WARNING] AUTH_SECRET is not set in production!");
    }
    return "fallback-dev-secret-only";
  }
  return secret;
}
```

---

## 3. Rate Limiting Middleware

Protect sensitive endpoints (Login, Register, Payment Verification, Order Creation, OTP submission) against automated brute-force attacks.

### Reusable Rate Limiter Helper (`src/lib/rate-limit.ts`)

```typescript
import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "127.0.0.1";
}

export function checkRateLimit(
  key: string,
  limit: number = 10,
  windowMs: number = 60 * 1000
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
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
    }
  );
}
```

### Applying to an API Route:
```typescript
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, 5, 60 * 1000); // 5 attempts per minute
  if (!rl.ok) return rateLimitResponse(rl.resetAt);

  // Process handler...
}
```

---

## 4. Payment Integrity & Financial Safeguards

1. **No Fake/Demo Payment Bypasses in Production**:
   - If an API key or merchant secret is missing in production (`NODE_ENV === "production"`), the request must explicitly fail. Never auto-approve payments with mock IDs in production.
2. **Restrict Test Simulation Codes**:
   - Hardcoded test codes (e.g. `99999`, `00000`, `DEMO_TX`) must be strictly guarded behind `if (process.env.NODE_ENV !== "production")`.
3. **Verify Ledger Amounts Server-Side**:
   - Verify that the recorded payment amount matches the actual order total before fulfilling goods.
4. **Idempotency & Race Condition Prevention**:
   - Verify that order status is currently `awaiting_payment` before processing. If already `paid` or `processing`, reject duplicate attempts.

---

## 5. Docker Container Hardening (Least Privilege)

Always drop `root` privileges in the production container.

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Copy assets and set ownership to 'node' user
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/scripts/start-all.sh ./start.sh

RUN chmod +x ./start.sh && \
    mkdir -p /app/data /app/data/uploads && \
    chown -R node:node /app/data /app/data/uploads

# Run as non-root user
USER node

EXPOSE 3000
CMD ["./start.sh"]
```

---

## 6. Path Traversal & File Upload Validation

When serving or reading uploaded files dynamically:
- Validate filenames with strict character regex (e.g. `/^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i`).
- Use `path.resolve` and ensure the canonical path stays strictly within the target directory:

```typescript
const baseDir = path.resolve(process.cwd(), "data", "uploads");
const targetPath = path.resolve(baseDir, filename);

if (!targetPath.startsWith(baseDir)) {
  return new Response("Not found", { status: 404 });
}
```

---

## 7. Pre-Deployment Environment Checklist

Before going live on production domains:

- [ ] `AUTH_SECRET`: Random 32+ character string configured.
- [ ] `ADMIN_PASSWORD`: Strong password set (not default `admin123456`).
- [ ] `NODE_ENV=production`: Active in container/hosting environment.
- [ ] `WATHANPAY_API_KEY` / Payment Secrets: Production keys configured.
- [ ] Database / Internal Services: Closed to public ports (only port 3000/443 exposed).
- [ ] Reverse Proxy: SSL/TLS certificate configured with HTTP -> HTTPS redirection.
