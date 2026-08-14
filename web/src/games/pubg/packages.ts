import type { Package } from "@/lib/types";

export const PUBG_ID = "game_pubg";

const rows: Array<[string, string, number, boolean]> = [
  ["60 UC", "60 UC", 2500, false],
  ["300 + 25 UC", "325 UC", 10500, false],
  ["600 + 60 UC", "660 UC", 21000, false],
  ["1500 + 300 UC", "1800 UC", 52000, false],
  ["3000 + 850 UC", "3850 UC", 104000, false],
  ["6000 + 2100 UC", "8100 UC", 208000, true],
];

export const packages: Package[] = rows.map(([name, displayName, priceKs, featured], i) => ({
  id: `pkg_pubg_${i + 1}`,
  gameId: PUBG_ID,
  name,
  displayName,
  priceKs,
  smileGoodsId: "",
  featured,
  isActive: true,
  sortOrder: i,
  offPercent: 0,
  offKs: 0,
}));
