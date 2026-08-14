import { existsSync, readFileSync } from "fs";
import path from "path";
import { loadShopEnv } from "./shop-env";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BALANCE_RE =
  /<div class="user-balance-section"[^>]*>[\s\S]*?<div class="balance-coins">\s*<p>[^<]*<\/p>\s*<p>([^<]+)<\/p>/i;

const LOGIN_TITLE_RE = /<title>[^<]*(login|entrar|sign\s*in)[^<]*<\/title>/i;

export type SmileSessionMeta = {
  present: boolean;
  valid: boolean;
  region: string;
  savedAt: string | null;
  hasPhpSessid: boolean;
  path: string | null;
};

export type SmileSupplierStatus = {
  session: SmileSessionMeta;
  balance: string | null;
  error: string | null;
  orderUrl: string;
  checkedAt: string;
};

type SessionFile = {
  cookie_header?: string;
  saved_at?: string;
  region?: string;
};

function region() {
  loadShopEnv();
  return (process.env.SMILE_REGION || "br").trim().toLowerCase() || "br";
}

export function smileOrderUrl() {
  loadShopEnv();
  const fromEnv = (process.env.SMILE_ORDER_URL || "").trim();
  if (fromEnv) return fromEnv;
  return `https://www.smile.one/${region()}/customer/order`;
}

function smileTimeoutMs() {
  loadShopEnv();
  const sec = Number(process.env.SMILE_TIMEOUT || 30);
  return Math.max(5, Number.isFinite(sec) ? sec : 30) * 1000;
}

export function smileSessionPath(): string | null {
  loadShopEnv();
  const fromEnv = (process.env.SMILE_SESSION_PATH || "").trim();
  const candidates = [
    fromEnv,
    path.join(process.cwd(), "..", ".data", "smileone_session.json"),
    path.join(process.cwd(), ".data", "smileone_session.json"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] || null;
}

function loadSessionFile(): { path: string; data: SessionFile } | null {
  const file = smileSessionPath();
  if (!file || !existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SessionFile;
    return { path: file, data };
  } catch {
    return null;
  }
}

function looksLikeLoginPage(html: string, finalUrl?: string | null) {
  if (html.includes("balance-coins")) return false;
  if (html.includes("info = JSON.parse")) return false;
  if (finalUrl?.includes("/customer/account/login")) return true;
  if (html.includes("customer/account/login")) return true;
  if (LOGIN_TITLE_RE.test(html)) return true;
  if (html.includes("Login with Google") || html.includes("Entrar com Google")) return true;
  return false;
}

function parseBalance(html: string) {
  const match = html.match(BALANCE_RE);
  return match?.[1]?.trim() || null;
}

async function fetchOrderPage(cookie: string, orderUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), smileTimeoutMs());
  try {
    const res = await fetch(orderUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: cookie,
      },
      cache: "no-store",
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

export async function getSmileSupplierStatus(): Promise<SmileSupplierStatus> {
  const orderUrl = smileOrderUrl();
  const checkedAt = new Date().toISOString();
  const loaded = loadSessionFile();

  if (!loaded) {
    return {
      session: {
        present: false,
        valid: false,
        region: region(),
        savedAt: null,
        hasPhpSessid: false,
        path: smileSessionPath(),
      },
      balance: null,
      error: "No Smile.one session file. Run the bot login script to create one.",
      orderUrl,
      checkedAt,
    };
  }

  const cookie = String(loaded.data.cookie_header || "").trim();
  const hasPhpSessid = cookie.includes("PHPSESSID=");
  const session: SmileSessionMeta = {
    present: Boolean(cookie),
    valid: false,
    region: String(loaded.data.region || region()),
    savedAt: String(loaded.data.saved_at || "") || null,
    hasPhpSessid,
    path: loaded.path,
  };

  if (!cookie || !hasPhpSessid) {
    return {
      session,
      balance: null,
      error: "Smile.one session is missing PHPSESSID. Refresh the session.",
      orderUrl,
      checkedAt,
    };
  }

  try {
    const page = await fetchOrderPage(cookie, orderUrl);
    if (looksLikeLoginPage(page.html, page.finalUrl)) {
      return {
        session,
        balance: null,
        error: "Smile.one session expired. Refresh via the bot login script.",
        orderUrl,
        checkedAt,
      };
    }
    if (!page.ok) {
      return {
        session,
        balance: null,
        error: `Smile.one returned HTTP ${page.status}.`,
        orderUrl,
        checkedAt,
      };
    }
    const balance = parseBalance(page.html);
    if (!balance) {
      return {
        session: { ...session, valid: true },
        balance: null,
        error: "Logged in, but balance could not be parsed from the order page.",
        orderUrl,
        checkedAt,
      };
    }
    return {
      session: { ...session, valid: true },
      balance,
      error: null,
      orderUrl,
      checkedAt,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Smile.one request timed out."
          : err.message
        : "Could not reach Smile.one.";
    return {
      session,
      balance: null,
      error: message,
      orderUrl,
      checkedAt,
    };
  }
}
