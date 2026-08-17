import { httpError } from "../shared/errors";
import type { GameAccount } from "../shared/types";

export async function verify(input: {
  gameUserId: string;
  zoneId: string;
}): Promise<GameAccount> {
  const id = input.gameUserId.trim();
  if (!/^\d{6,16}$/.test(id)) {
    throw httpError("Enter a valid PUBG Player ID.", 400);
  }

  if (process.env.PUBG_DEMO_VERIFY === "0") {
    throw httpError("PUBG account lookup is not connected yet.", 501);
  }

  return {
    gameUserId: id,
    zoneId: input.zoneId.trim(),
    nickname: "PUBG Player",
    country: "Myanmar",
    region: "Myanmar",
  };
}
