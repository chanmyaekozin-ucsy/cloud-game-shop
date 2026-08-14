import type { Package } from "@/lib/types";

export const MLBB_ID = "game_mlbb";

const rows: Array<[string, string, number, string, boolean]> = [
  ["Weekly Elite Bundle", "Weekly Elite Bundle", 3600, "26555", false],
  ["Monthly Epic Bundle", "Monthly Epic Bundle", 18100, "26556", false],
  ["Diamond×50 +5", "50+5", 3600, "22590", false],
  ["Diamond×150 +15", "150+15", 10800, "22591", false],
  ["Diamond×250 +25", "250+25", 17200, "22592", false],
  ["Diamond×500 +65", "500+65", 35400, "22593", false],
  ["Diamond×78 +8", "78+8", 5700, "13", false],
  ["Diamond×156 +16", "156+16", 11200, "23", false],
  ["Diamond×234 +23", "234+23", 16300, "25", false],
  ["Diamond×625 +81", "625+81", 44200, "26", false],
  ["Diamond×1860 +335", "1860+335", 133700, "27", false],
  ["Diamond×3099 +589", "3099+589", 223000, "28", false],
  ["Diamond×4649 +883", "4649+883", 336700, "29", false],
  ["Diamond×7740 +1548", "7740+1548", 547000, "30", false],
  ["Weekly Pass", "Weekly Pass", 6700, "16642", true],
  ["Twilight Pass", "Twilight Pass", 36000, "33", true],
];

export const packages: Package[] = rows.map(
  ([name, displayName, priceKs, smileGoodsId, featured], i) => ({
    id: `pkg_mlbb_${i + 1}`,
    gameId: MLBB_ID,
    name,
    displayName,
    priceKs,
    smileGoodsId,
    featured,
    isActive: true,
    sortOrder: i,
    offPercent: 0,
    offKs: 0,
  }),
);
