import type { Package } from "@/lib/types";

export const FREEFIRE_ID = "game_ff";

const rows: Array<[string, string, number, boolean]> = [
  ["100 Diamonds", "100", 2500, false],
  ["310 Diamonds", "310", 7500, false],
  ["520 Diamonds", "520", 12500, false],
  ["1060 Diamonds", "1060", 25000, false],
  ["2180 Diamonds", "2180", 50000, true],
];

export const packages: Package[] = rows.map(([name, displayName, priceKs, featured], i) => ({
  id: `pkg_ff_${i + 1}`,
  gameId: FREEFIRE_ID,
  name,
  displayName,
  priceKs,
  smileGoodsId: "",
  smileCoin: 0,
  featured,
  isActive: true,
  sortOrder: i,
  offPercent: 0,
  offKs: 0,
}));
