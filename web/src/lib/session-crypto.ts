import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { loadShopEnv } from "./shop-env";

const MAGIC = "CGS1"; // format version marker
const SCRYPT_KEYLEN = 32;

/**
 * Encryption key for the supplier session at rest. Required in production;
 * without it the session file stays readable by anyone with disk access.
 * Generate with: openssl rand -base64 48
 */
function sessionKey(): Buffer | null {
  loadShopEnv();
  const secret = (process.env.SMILE_SESSION_SECRET || "").trim();
  if (!secret) return null;
  return scryptSync(secret, "cgs-smile-session-v1", SCRYPT_KEYLEN);
}

type EncryptedPayload = {
  v: number;
  iv: string;
  tag: string;
  data: string;
};

export function sessionEncryptionEnabled(): boolean {
  return Boolean(sessionKey());
}

/** Returns ciphertext prefixed with MAGIC, or the plaintext unchanged if no key is set. */
export function encryptSession(plaintext: string): string {
  const key = sessionKey();
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: enc.toString("base64"),
  };
  return MAGIC + JSON.stringify(payload);
}

/**
 * Decrypts a MAGIC-prefixed payload. Plaintext (legacy) input passes through
 * with encrypted=false so callers can migrate transparently on next write.
 */
export function decryptSession(stored: string): { value: string; encrypted: boolean } {
  if (!stored.startsWith(MAGIC)) {
    return { value: stored, encrypted: false };
  }
  const key = sessionKey();
  if (!key) {
    throw new Error(
      "[CONFIG] SMILE_SESSION_SECRET is not set but the session file is encrypted. Set it or re-save the session.",
    );
  }
  const payload = JSON.parse(stored.slice(MAGIC.length)) as EncryptedPayload;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return { value: dec.toString("utf8"), encrypted: true };
}
