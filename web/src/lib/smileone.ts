import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
    "/data/smileone/smileone_session.json",
    path.join(process.cwd(), "data", "smileone_session.json"),
    path.join(process.cwd(), "..", ".data", "smileone_session.json"),
    path.join(process.cwd(), ".data", "smileone_session.json"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] || path.join(process.cwd(), "data", "smileone_session.json");
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

function extractPhpsessid(cookieHeader: string): string | null {
  const match = cookieHeader.match(/PHPSESSID=([^;\s]+)/i);
  return match?.[1] || null;
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
  const phpsessid = extractPhpsessid(cookie);
  const hasPhpSessid = Boolean(phpsessid);
  const session: SmileSessionMeta = {
    present: Boolean(cookie),
    valid: false,
    region: String(loaded.data.region || region()),
    savedAt: String(loaded.data.saved_at || "") || null,
    hasPhpSessid,
    path: loaded.path ? path.basename(loaded.path) : null,
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

export async function updateSmileSession(input: {
  phpsessid?: string;
  cookieHeader?: string;
  region?: string;
}): Promise<{ ok: boolean; message: string; supplier: SmileSupplierStatus }> {
  loadShopEnv();
  const targetPath =
    smileSessionPath() ||
    path.join(process.cwd(), "..", ".data", "smileone_session.json");

  let existingData: SessionFile & {
    cookies?: Array<{ name: string; value: string; [k: string]: unknown }>;
  } = {};

  if (existsSync(targetPath)) {
    try {
      existingData = JSON.parse(readFileSync(targetPath, "utf8"));
    } catch {
      existingData = {};
    }
  }

  let cookieHeader = (input.cookieHeader ?? existingData.cookie_header ?? "").trim();
  const reg = (input.region ?? existingData.region ?? region()).trim().toLowerCase() || "br";

  if (input.phpsessid !== undefined && input.phpsessid.trim() !== "") {
    const rawVal = input.phpsessid.trim();
    // If the input is full cookie header copied from browser DevTools
    if (rawVal.includes(";") && rawVal.includes("=")) {
      cookieHeader = rawVal;
    } else {
      const match = rawVal.match(/PHPSESSID=([^;\s]+)/i);
      const cleanToken = match ? match[1] : rawVal.replace(/^PHPSESSID=/i, "").split(";")[0].trim();

      if (cleanToken) {
        if (cookieHeader.includes("PHPSESSID=")) {
          cookieHeader = cookieHeader.replace(/PHPSESSID=[^;]+/i, `PHPSESSID=${cleanToken}`);
        } else {
          cookieHeader = cookieHeader ? `${cookieHeader}; PHPSESSID=${cleanToken}` : `PHPSESSID=${cleanToken}`;
        }

        const cookiesList = Array.isArray(existingData.cookies) ? [...existingData.cookies] : [];
        const phpIdx = cookiesList.findIndex((c) => c.name === "PHPSESSID");
        if (phpIdx >= 0) {
          cookiesList[phpIdx] = { ...cookiesList[phpIdx], value: cleanToken };
        } else {
          cookiesList.push({
            name: "PHPSESSID",
            value: cleanToken,
            domain: "www.smile.one",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          });
        }
        existingData.cookies = cookiesList;
      }
    }
  } else if (input.cookieHeader !== undefined && input.cookieHeader.trim() !== "") {
    cookieHeader = input.cookieHeader.trim();
  }

  existingData.cookie_header = cookieHeader;
  existingData.region = reg;
  existingData.saved_at = new Date().toISOString();

  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(existingData, null, 2) + "\n", "utf8");

  const supplier = await getSmileSupplierStatus();
  const isOk = Boolean(supplier.session.valid && supplier.balance);
  return {
    ok: isOk,
    message: isOk
      ? "Smile.one session saved and verified successfully!"
      : supplier.error
        ? `Saved to ${path.basename(targetPath)}, but verification returned: ${supplier.error}`
        : "Smile.one session saved successfully.",
    supplier,
  };
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

export const GOODS_COIN_MAP: Record<string, number> = {
  "16642": 76,
  "26555": 39,
  "26556": 196.5,
  "22590": 39,
  "22591": 116.9,
  "22592": 187.5,
  "22593": 385,
  "13": 61.5,
  "23": 122,
  "25": 176.7,
  "26": 480,
  "27": 1453,
  "28": 2424,
  "29": 3660,
  "30": 6079,
  "33": 402.5,
};

export async function validateSmileonePackageAvailability(pkg: {
  gameId?: string;
  smileGoodsId?: string;
  smileCoin?: number;
}): Promise<{ ok: boolean; error?: string; reason?: "check_failed" | "not_enough" }> {
  // Only apply to MLBB / packages with smileGoodsId
  const isMlbb = pkg.gameId === "game_mlbb" || pkg.gameId === "mlbb";
  if (!isMlbb && !pkg.smileGoodsId) {
    return { ok: true };
  }
  if (!pkg.smileGoodsId && (!pkg.smileCoin || pkg.smileCoin <= 0)) {
    return { ok: true };
  }

  const supplier = await getSmileSupplierStatus();
  if (supplier.error || !supplier.session.valid || !supplier.balance) {
    return {
      ok: false,
      reason: "check_failed",
      error: "Auto စနစ် မရနိုင်သေးပါ။ Admin ထံမှ တိုက်ရိုက်ဝယ်ယူနိုင်ပါတယ်။",
    };
  }

  const cleanBalStr = supplier.balance.replace(/[^\d.]/g, "");
  const numericBalance = parseFloat(cleanBalStr) || 0;
  const requiredCoins =
    Number(pkg.smileCoin) > 0
      ? Number(pkg.smileCoin)
      : pkg.smileGoodsId
        ? GOODS_COIN_MAP[pkg.smileGoodsId] || 0
        : 0;

  if (requiredCoins > 0 && numericBalance < requiredCoins) {
    return {
      ok: false,
      reason: "not_enough",
      error:
        "ဤ Package ကိုဝယ်ယူလို့မရနိုင်သေးပါ။ အခြား Package များကို ရွေးချယ်ပေးပါ။ သို့မဟုတ် Admin ထံမှ တိုက်ရိုက်ဝယ်ယူနိုင်ပါတယ်။",
    };
  }

  return { ok: true };
}


