import { GAME_MODULES, toGameRecord } from "@/games/shared/catalog";
import { hashPin } from "./hash";
import { loadShopEnv } from "./shop-env";
import type { Store, User } from "./types";

export function adminCredentials() {
  loadShopEnv();
  const email = (process.env.ADMIN_EMAIL || "admin@cloudgameshop.com").trim().toLowerCase();
  const pin = (process.env.ADMIN_PIN || "123456").trim();
  return {
    email: email || "admin@cloudgameshop.com",
    pin: pin.length === 6 ? pin : "123456",
  };
}

export function seedStore(): Store {
  const admin = adminCredentials();
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
        email: admin.email,
        role: "admin",
        pinHash: hashPin(admin.pin),
        balanceKs: 0,
      },
    ],
    games: GAME_MODULES.map(toGameRecord),
    packages: GAME_MODULES.flatMap((game) => game.packages),
    orders: [],
    transactions: [],
  };
}

/** Keep the seeded admin account in sync with ADMIN_EMAIL / ADMIN_PIN. */
export function syncAdminFromEnv(store: Store) {
  const { email, pin } = adminCredentials();
  const pinHash = hashPin(pin);
  const admin = store.users.find((u) => u.id === "user_admin" || u.role === "admin");
  if (!admin) {
    const created: User = {
      id: "user_admin",
      name: "Admin",
      phone: "09970000001",
      email,
      role: "admin",
      pinHash,
      balanceKs: 0,
    };
    store.users.push(created);
    return true;
  }
  let changed = false;
  if (admin.email !== email) {
    admin.email = email;
    changed = true;
  }
  if (admin.pinHash !== pinHash) {
    admin.pinHash = pinHash;
    changed = true;
  }
  if (admin.role !== "admin") {
    admin.role = "admin";
    changed = true;
  }
  return changed;
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
