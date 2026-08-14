import { httpError } from "../shared/errors";
import type { GameAccount } from "../shared/types";
import { REGION_MAP } from "./regions";

const VALIDASI =
  process.env.MLBB_VALIDASI_URL || "https://htetgameshop.com/api/mlbb/validasi";
const REFERER =
  process.env.MLBB_REGIONCHECK_REFERER || "https://htetgameshop.com/region-check";

export async function verify(input: {
  gameUserId: string;
  zoneId: string;
}): Promise<GameAccount> {
  const id = input.gameUserId.trim();
  const zone = input.zoneId.trim();
  if (!/^\d{4,16}$/.test(id) || !/^\d{2,8}$/.test(zone)) {
    throw httpError("Enter Game ID and Server as numbers.", 400);
  }

  const url = `${VALIDASI}?id=${encodeURIComponent(id)}&serverid=${encodeURIComponent(zone)}`;
  let data: Record<string, unknown> | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Referer: REFERER,
        "User-Agent": "CloudGameShop/1.0",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      if (json && typeof json === "object") data = json;
    }
  } catch {
    data = null;
  }

  if (data?.status === "success" && data.result && typeof data.result === "object") {
    const result = data.result as { nickname?: string; country?: string };
    const nickname = String(result.nickname ?? "").trim();
    const country = String(result.country ?? "").trim();
    if (!nickname && !country) throw httpError("Account not found.", 404);
    return {
      gameUserId: id,
      zoneId: zone,
      nickname: nickname || "Unknown",
      country,
      region: REGION_MAP[country] || country || "Unknown",
    };
  }

  if (!data && process.env.MLBB_DEMO_VERIFY !== "0") {
    return {
      gameUserId: id,
      zoneId: zone,
      nickname: "Demo Player",
      country: "Myanmar",
      region: "SEA",
    };
  }

  const hint =
    (data && String(data.message ?? data.error ?? data.status ?? "")) ||
    "Could not verify this account.";
  throw httpError(hint, 404);
}
