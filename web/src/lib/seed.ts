import { GAME_MODULES, toGameRecord } from "@/games/shared/catalog";
import { hashPin } from "./hash";
import type { Store } from "./types";

export function seedStore(): Store {
  return {
    users: [
      {
        id: "user_demo",
        name: "Aung Aung",
        phone: "09970000000",
        email: "user@cloudgameshop.com",
        role: "user",
        pinHash: hashPin("123456"),
        balanceKs: 500000,
      },
      {
        id: "user_admin",
        name: "Admin",
        phone: "09970000001",
        email: "admin@cloudgameshop.com",
        role: "admin",
        pinHash: hashPin("123456"),
        balanceKs: 0,
      },
    ],
    games: GAME_MODULES.map(toGameRecord),
    packages: GAME_MODULES.flatMap((game) => game.packages),
    orders: [],
    transactions: [],
  };
}

export function mergeCatalog(store: Store) {
  for (const mod of GAME_MODULES) {
    const record = toGameRecord(mod);
    const existing = store.games.find((game) => game.id === mod.id);
    if (!existing) {
      store.games.push(record);
    } else {
      existing.name = record.name;
      existing.slug = record.slug;
      existing.needsVerify = record.needsVerify;
      existing.idLabel = record.idLabel;
      existing.zoneLabel = record.zoneLabel;
      existing.packageLabel = record.packageLabel;
      existing.fields = record.fields;
    }
    const hasPackages = store.packages.some((pkg) => pkg.gameId === mod.id);
    if (!hasPackages) store.packages.push(...mod.packages);
  }
  for (const pkg of store.packages) {
    if (typeof pkg.offPercent !== "number" || Number.isNaN(pkg.offPercent)) pkg.offPercent = 0;
    if (typeof pkg.offKs !== "number" || Number.isNaN(pkg.offKs)) pkg.offKs = 0;
  }
}
