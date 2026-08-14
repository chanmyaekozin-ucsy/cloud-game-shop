import { createHash } from "crypto";

export function hashPin(pin: string) {
  return createHash("sha256").update(`cgs:${pin}`).digest("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}
