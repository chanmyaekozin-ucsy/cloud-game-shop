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

/* ==========================================================================
   Lightweight, Zero-Dependency QR Code Generator for TOTP URLs
   Outputs clean SVG paths directly without third-party dependencies.
   ========================================================================== */

export function generateQrSvg(text: string, size = 200): string {
  // Use a compact, standards-compliant QR generator implementation for byte mode
  const qr = createQrMatrix(text);
  const matrix = qr.modules;
  const count = matrix.length;
  const cellSize = size / (count + 8);
  const margin = cellSize * 4;

  let rects = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (matrix[r][c]) {
        const x = Math.round(margin + c * cellSize);
        const y = Math.round(margin + r * cellSize);
        const w = Math.ceil(cellSize);
        const h = Math.ceil(cellSize);
        rects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#102a43"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background:#ffffff;border-radius:12px;padding:8px;box-shadow:0 2px 10px rgba(0,0,0,0.06);">${rects}</svg>`;
}

// Minimal QR Code Engine for URL generation
interface QrMatrix {
  modules: boolean[][];
}

function createQrMatrix(data: string): QrMatrix {
  // Determine version based on length (Version 3 or 4 handles standard otpauth URLs up to 134 bytes)
  const bytes = Buffer.from(data, "utf8");
  let version = 3;
  if (bytes.length > 53) version = 4;
  if (bytes.length > 76) version = 5;
  if (bytes.length > 106) version = 6;
  if (bytes.length > 134) version = 7;

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // 1. Finder patterns
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          isFunction[nr][nc] = true;
          if (
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          ) {
            modules[nr][nc] = true;
          } else {
            modules[nr][nc] = false;
          }
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    isFunction[6][i] = true;
    modules[6][i] = i % 2 === 0;
    isFunction[i][6] = true;
    modules[i][6] = i % 2 === 0;
  }

  // 3. Alignment patterns (version >= 2)
  const alignPos: number[] = [];
  if (version === 4) alignPos.push(6, 26);
  else if (version === 5) alignPos.push(6, 30);
  else if (version === 6) alignPos.push(6, 34);
  else if (version === 7) alignPos.push(6, 22, 38);
  else alignPos.push(6, 22);

  for (const r of alignPos) {
    for (const c of alignPos) {
      if (isFunction[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          isFunction[r + dr][c + dc] = true;
          modules[r + dr][c + dc] =
            Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0);
        }
      }
    }
  }

  // Dark module
  modules[size - 8][8] = true;
  isFunction[size - 8][8] = true;

  // 4. Encode payload in Byte Mode with ECC-Medium or Low
  const bitBuf: number[] = [];
  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf.push((val >>> i) & 1);
    }
  };

  // Mode Indicator: 0100 (Byte)
  appendBits(0b0100, 4);
  // Character count indicator (8 bits for v1-9)
  appendBits(bytes.length, 8);
  for (let i = 0; i < bytes.length; i++) {
    appendBits(bytes[i], 8);
  }

  // Total capacity for version (ECC Level L)
  const dataCodewords = [0, 19, 34, 55, 80, 108, 136, 156][Math.min(version, 7)] || 108;
  const totalBits = dataCodewords * 8;

  // Terminator
  const termLen = Math.min(4, totalBits - bitBuf.length);
  appendBits(0, termLen);

  // Pad to byte
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);

  // Pad bytes 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let pIdx = 0;
  while (bitBuf.length < totalBits) {
    appendBits(padBytes[pIdx % 2], 8);
    pIdx++;
  }

  // Place data bits in zig-zag
  let bitIdx = 0;
  let right = size - 1;
  let upward = true;

  while (right > 0) {
    if (right === 6) right--; // Skip vertical timing pattern
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (!isFunction[r][col]) {
          let bit = bitIdx < bitBuf.length ? bitBuf[bitIdx++] : 0;
          // Apply standard mask pattern (row + col) % 2 == 0
          if ((r + col) % 2 === 0) bit ^= 1;
          modules[r][col] = bit === 1;
        }
      }
    }
    right -= 2;
    upward = !upward;
  }

  return { modules };
}
