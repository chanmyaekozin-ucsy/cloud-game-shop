import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

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
 * Timing-safe password and PIN verification.
 * Supports both modern scrypt hashes and legacy SHA-256 hashes for seamless backward compatibility.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  try {
    // 1. Modern scrypt format: scrypt:<salt>:<hash>
    if (storedHash.startsWith("scrypt:")) {
      const parts = storedHash.split(":");
      if (parts.length !== 3) return false;
      const [, salt, expectedHex] = parts;
      const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
      const expectedBuf = Buffer.from(expectedHex, "hex");
      if (derived.length !== expectedBuf.length) return false;
      return timingSafeEqual(derived, expectedBuf);
    }

    // 2. Legacy SHA-256 fallback: sha256("cgs:" + password)
    const legacyHash = createHash("sha256").update(`cgs:${password}`).digest("hex");
    const legacyBuf = Buffer.from(legacyHash);
    const storedBuf = Buffer.from(storedHash);
    if (legacyBuf.length !== storedBuf.length) return false;
    return timingSafeEqual(legacyBuf, storedBuf);
  } catch {
    return false;
  }
}

export const verifyPin = verifyPassword;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}
