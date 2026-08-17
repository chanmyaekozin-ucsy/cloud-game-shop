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

function extractCsrf(html: string): string | null {
  const match = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/name=["']_csrf["'][^>]+value=["']([^"']+)["']/i) ||
    html.match(/_csrf\s*=\s*["']([^"']+)["']/i);
  return match?.[1] || null;
}

export async function paySmileoneMlbb(input: {
  gameUserId: string;
  zoneId: string;
  smileGoodsId: string;
}): Promise<{ ok: boolean; message: string }> {
  const loaded = loadSessionFile();
  if (!loaded || !loaded.data.cookie_header) {
    return { ok: false, message: "No Smile.one session cookie configured." };
  }
  const cookie = loaded.data.cookie_header;
  const reg = region();
  const merchantUrl = `https://www.smile.one/${reg}/merchant`;
  const referer = `https://www.smile.one/${reg}/merchant`;

  try {
    const page = await fetchOrderPage(cookie, merchantUrl);
    if (looksLikeLoginPage(page.html, page.finalUrl)) {
      return { ok: false, message: "Smile.one session expired." };
    }
    const csrf = extractCsrf(page.html);
    if (!csrf) {
      return { ok: false, message: "Could not parse CSRF token from Smile.one." };
    }

    const basePayload = {
      user_id: input.gameUserId.trim(),
      zone_id: input.zoneId.trim(),
      pid: input.smileGoodsId.trim(),
      pay_methond: "smilecoin",
      channel_method: "smilecoin",
    };

    // 1. checkrole
    const checkRes = await fetch(`https://www.smile.one/${reg}/merchant/checkrole`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Referer: referer,
      },
      body: new URLSearchParams({ ...basePayload, checkrole: "1" }).toString(),
    });
    const checkJson = (await checkRes.json().catch(() => ({}))) as { code?: number; info?: string };
    if (Number(checkJson.code) !== 200) {
      return { ok: false, message: checkJson.info || "MLBB account validation failed on Smile.one." };
    }

    // 2. query -> flowid
    const queryRes = await fetch(`https://www.smile.one/${reg}/merchant/query`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Referer: referer,
      },
      body: new URLSearchParams({ ...basePayload, checkrole: "" }).toString(),
    });
    const queryJson = (await queryRes.json().catch(() => ({}))) as { code?: number; flowid?: string; info?: string };
    const flowid = queryJson.flowid || "";
    if (Number(queryJson.code) !== 200 || !flowid) {
      return { ok: false, message: queryJson.info || "Smile.one did not issue a flow ID." };
    }

    // 3. customer check
    await fetch(`https://www.smile.one/${reg}/merchant/customer`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Referer: referer,
      },
      body: new URLSearchParams({ check: "check" }).toString(),
    }).catch(() => undefined);

    // 4. pay
    const payRes = await fetch(`https://www.smile.one/${reg}/merchant/pay`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: merchantUrl,
      },
      body: new URLSearchParams({
        user_id: input.gameUserId.trim(),
        zone_id: input.zoneId.trim(),
        pay_methond: "smilecoin",
        product_id: input.smileGoodsId.trim(),
        channel_method: "smilecoin",
        flowid,
        email: "",
        coupon_id: "",
        _csrf: csrf,
      }).toString(),
    });

    const payHtml = await payRes.text();
    const finalUrl = payRes.url;
    if (finalUrl.includes("/success") || payHtml.includes("Payment Successful") || payHtml.includes("Success")) {
      return { ok: true, message: `Smile.one Top-up Succeeded (goods: ${input.smileGoodsId})` };
    }

    return { ok: false, message: "Smile.one payment did not return success page." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Top-up request failed." };
  }
}

