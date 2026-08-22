import { httpError } from "../shared/errors";
import type { GameAccount } from "../shared/types";

export async function verify(input: {
  gameUserId: string;
  zoneId: string;
}): Promise<GameAccount> {
  // No real lookup integration exists for PUBG. Verification is required
  // before an order can be created, so this module fails closed rather than
  // returning a fabricated account.
  throw httpError(
    "PUBG account verification is not available yet. Please contact support to order.",
    501,
  );
}
