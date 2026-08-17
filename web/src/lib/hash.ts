import { createHash } from "crypto";

export function hashPassword(password: string) {
  return createHash("sha256").update(`cgs:${password}`).digest("hex");
}

export const hashPin = hashPassword;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}
