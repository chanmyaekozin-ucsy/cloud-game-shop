import { httpError } from "../shared/errors";
import type { GameAccount } from "../shared/types";

export async function verify(input: {
  gameUserId: string;
  zoneId: string;
}): Promise<GameAccount> {
  // No real lookup integration exists for Free Fire. Verification is
  // required before an order can be created, so this module fails closed
  // rather than returning a fabricated account.
  throw httpError(
    "Free Fire account verification is not available yet. Please contact support to order.",
    501,
  );
}
