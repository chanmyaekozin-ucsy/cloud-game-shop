import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Derives a secure password hash using scrypt with a unique per-user salt.
 * Output format: `scrypt:<saltHex>:<derivedHex>`
 */
export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex || randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export const hashPin = hashPassword;

/**
 * Timing-safe scrypt verification. Legacy unsalted SHA-256 hashes are NOT
 * accepted: they must be migrated (scripts/migrate-store.ts) or reset.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  try {
    if (!storedHash.startsWith("scrypt:")) return false;
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (derived.length !== expectedBuf.length) return false;
    return timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

export const verifyPin = verifyPassword;

export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}
