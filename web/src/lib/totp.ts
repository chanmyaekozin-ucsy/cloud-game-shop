import { createHmac, randomBytes } from "crypto";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

export function decodeBase32(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_CHARS.indexOf(clean[i]);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

/**
 * Generate 6-digit TOTP code for a given timestamp and secret.
 * Implements RFC 6238 and RFC 4226 (HOTP).
 */
export function generateTotp(secretBase32: string, timestampMs = Date.now(), periodSec = 30): string {
  const counter = Math.floor(timestampMs / 1000 / periodSec);
  const secret = decodeBase32(secretBase32);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = binary % 1000000;
  return code.toString().padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP code with time-skew tolerance (window = 1 means -30s, 0s, +30s).
 */
export function verifyTotp(
  token: string,
  secretBase32: string,
  window = 1,
  periodSec = 30
): boolean {
  const cleanToken = String(token ?? "").trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const time = now + i * periodSec * 1000;
    const generated = generateTotp(secretBase32, time, periodSec);
    if (generated === cleanToken) {
      return true;
    }
  }
  return false;
}

export function getOtpAuthUrl(
  secretBase32: string,
  account = "admin@cloudgameshop.com",
  issuer = "Cloud Game Shop"
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secretBase32}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

import QRCode from "qrcode";

export async function generateQrSvg(text: string, size = 220): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 2,
    width: size,
    errorCorrectionLevel: "M",
  });
}
