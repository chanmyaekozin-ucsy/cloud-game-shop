import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce for the CSP. Setting the policy on the request headers
 * (not just the response) is what makes Next.js stamp its inline bootstrap
 * scripts with the same nonce, which lets script-src drop 'unsafe-inline'
 * and 'unsafe-eval'.
 */
function csp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' ignores host allowlists: trust flows from nonced
    // scripts to anything they load at runtime. The WathanPay/Telegram SDK
    // tags carry the nonce explicitly (see app/layout.tsx).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'", // React inline styles; no script execution risk
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.wathanpay.com https://*.smile.one",
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src https://oauth.telegram.org https://telegram.org",
  ].join("; ");
}

export default function proxy(req: NextRequest) {
  // Fresh unpredictable nonce per request; replaying old markup against the
  // current policy fails.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-nonce", nonce);
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = {
  matcher: [
    // Protect everything except static assets that never execute scripts.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|uploads/).*)",
  ],
};
