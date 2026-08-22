import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { decryptSession, encryptSession, sessionEncryptionEnabled } from "./session-crypto";
import { loadShopEnv } from "./shop-env";

const SESSION_FILE_MODE = 0o600;

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
  let raw: SessionFile;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as SessionFile;
  } catch {
    // Unreadable/corrupt JSON is a missing session, not a security event.
    return null;
  }
  // Decrypt outside the parse try-block: a missing key or tampered ciphertext
  // must surface as an error, never masquerade as "no session configured".
  if (raw.cookie_header) {
    raw.cookie_header = decryptSession(raw.cookie_header).value;
  }
  return { path: file, data: raw };
}

/**
 * Detect a real login wall — not mere nav links to /login (404 and merchant
 * pages both contain those and used to false-positive as "session expired").
 */
function looksLikeLoginPage(html: string, finalUrl?: string | null) {
  const url = (finalUrl || "").toLowerCase();
  if (url.includes("/customer/account/login") || url.includes("/account/login")) {
    return true;
  }
  // Strong logged-in / merchant-shop markers
  if (html.includes("balance-coins")) return false;
  if (html.includes("info = JSON.parse")) return false;
  if (/name=["']_csrf["']/i.test(html) && /merchant\/[^/"']+\/pay/i.test(html)) return false;

  if (LOGIN_TITLE_RE.test(html)) return true;
  // Google login CTA only counts when the page looks like an auth screen
  if (
    (html.includes("Login with Google") || html.includes("Entrar com Google")) &&
    !html.includes("js_checkrole_url")
  ) {
    return true;
  }
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

  // Existing file may be encrypted; normalize to a plaintext header for merging.
  let existingHeader = "";
  let existingRegion: string | undefined;
  if (existsSync(targetPath)) {
    try {
      const raw = JSON.parse(readFileSync(targetPath, "utf8")) as SessionFile & {
        cookies?: Array<{ name: string; value: string }>;
      };
      existingRegion =
        typeof raw.region === "string" ? raw.region : undefined;
      if (raw.cookie_header) {
        existingHeader = decryptSession(raw.cookie_header).value.trim();
      } else if (Array.isArray(raw.cookies)) {
        // Legacy structured-cookie format: rebuild the header from the array.
        existingHeader = raw.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
      }
    } catch {
      existingHeader = "";
    }
  }

  let cookieHeader = (input.cookieHeader ?? existingHeader).trim();
  const reg = (input.region ?? existingRegion ?? region()).trim().toLowerCase() || "br";

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
      }
    }
  } else if (input.cookieHeader !== undefined && input.cookieHeader.trim() !== "") {
    cookieHeader = input.cookieHeader.trim();
  }

  const savedAt = new Date().toISOString();

  mkdirSync(path.dirname(targetPath), { recursive: true });
  // Single source of truth: the (encrypted) header. The legacy `cookies`
  // array is dropped on write so no plaintext PHPSESSID ever touches disk.
  const toWrite = {
    cookie_header: encryptSession(cookieHeader),
    region: reg,
    saved_at: savedAt,
    ...(sessionEncryptionEnabled() ? { encrypted: true } : {}),
  };
  writeFileSync(targetPath, JSON.stringify(toWrite, null, 2) + "\n", { encoding: "utf8", mode: SESSION_FILE_MODE });

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

/** MLBB merchant shop paths on Smile.one (region-scoped HTML, global AJAX). */
function smileMlbbMerchantPaths(reg: string) {
  const base = "https://www.smile.one";
  const shop = `${base}/${reg}/merchant/mobilelegends`;
  return {
    shop,
    referer: shop,
    checkrole: `${base}/merchant/mobilelegends/checkrole`,
    query: `${base}/merchant/mobilelegends/query`,
    customer: `${base}/merchant/customer`,
    pay: `${base}/${reg}/merchant/mobilelegends/pay`,
  };
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
  const paths = smileMlbbMerchantPaths(reg);

  try {
    // Prefer the real MLBB shop page — `/br/merchant` is a 404 and used to be
    // misread as "session expired" because the 404 HTML links to login.
    const page = await fetchOrderPage(cookie, paths.shop);
    if (looksLikeLoginPage(page.html, page.finalUrl)) {
      return { ok: false, message: "Smile.one session expired." };
    }
    if (!page.ok) {
      return {
        ok: false,
        message: `Smile.one merchant page returned HTTP ${page.status}.`,
      };
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

    const jsonHeaders = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookie,
      Referer: paths.referer,
      "X-Requested-With": "XMLHttpRequest",
    };

    // 1. checkrole (validates account; may already return flowid)
    const checkRes = await fetch(paths.checkrole, {
      method: "POST",
      headers: jsonHeaders,
      body: new URLSearchParams({ ...basePayload, checkrole: "1" }).toString(),
    });
    const checkJson = (await checkRes.json().catch(() => ({}))) as {
      code?: number;
      info?: string;
      flowid?: string;
    };
    if (Number(checkJson.code) !== 200) {
      return { ok: false, message: checkJson.info || "MLBB account validation failed on Smile.one." };
    }

    // 2. queryorder -> flowid (required before pay)
    let flowid = String(checkJson.flowid || "").trim();
    if (!flowid) {
      const queryRes = await fetch(paths.query, {
        method: "POST",
        headers: jsonHeaders,
        body: new URLSearchParams({ ...basePayload, checkrole: "" }).toString(),
      });
      const queryJson = (await queryRes.json().catch(() => ({}))) as {
        code?: number;
        flowid?: string;
        info?: string;
      };
      flowid = String(queryJson.flowid || "").trim();
      if (Number(queryJson.code) !== 200 || !flowid) {
        return { ok: false, message: queryJson.info || "Smile.one did not issue a flow ID." };
      }
    }

    // 3. customer check (same as browser shop JS)
    await fetch(paths.customer, {
      method: "POST",
      headers: jsonHeaders,
      body: new URLSearchParams({ check: "check" }).toString(),
    }).catch(() => undefined);

    // 4. pay
    const payRes = await fetch(paths.pay, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: paths.referer,
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
      redirect: "follow",
    });

    const payHtml = await payRes.text();
    const finalUrl = payRes.url;
    if (
      finalUrl.includes("/success") ||
      /payment successful/i.test(payHtml) ||
      /pagamento\s+(realizado\s+)?com\s+sucesso/i.test(payHtml) ||
      (payHtml.includes("Success") && !looksLikeLoginPage(payHtml, finalUrl))
    ) {
      return { ok: true, message: `Smile.one Top-up Succeeded (goods: ${input.smileGoodsId})` };
    }

    if (looksLikeLoginPage(payHtml, finalUrl)) {
      return { ok: false, message: "Smile.one session expired during payment." };
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


