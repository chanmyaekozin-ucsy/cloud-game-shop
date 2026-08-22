import { GAME_MODULES, toGameRecord } from "@/games/shared/catalog";
import { hashPin } from "./hash";
import { loadShopEnv } from "./shop-env";
import type { Store } from "./types";

export function adminCredentials() {
  loadShopEnv();
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PIN || "").trim();

  if (!email || !password) {
    throw new Error(
      "[CONFIG] ADMIN_EMAIL and ADMIN_PASSWORD must be set. Refusing to seed an admin account with default credentials.",
    );
  }

  return { email, password };
}

export function assertRequiredEnvConfigured() {
  adminCredentials();
  if (!process.env.AUTH_SECRET) {
    throw new Error(
      "[CONFIG] AUTH_SECRET is not set. Refusing to run: sessions cannot be signed securely. Generate one with `openssl rand -base64 48`.",
    );
  }
}

export function seedStore(): Store {
  const admin = adminCredentials();
  return {
    users: [
      {
        id: "user_admin",
        name: "Admin",
        phone: "",
        email: admin.email,
        role: "admin",
        pinHash: hashPin(admin.password),
        balanceKs: 0,
      },
    ],
    games: GAME_MODULES.map(toGameRecord),
    packages: GAME_MODULES.flatMap((game) => game.packages),
    orders: [],
    transactions: [],
  };
}

/** Keep the seeded admin account in sync with ADMIN_EMAIL / ADMIN_PASSWORD. */
export function syncAdminFromEnv(store: Store): boolean {
  const { email, password } = adminCredentials();
  let admin = store.users.find((u) => u.id === "user_admin" || u.role === "admin");
  if (!admin) {
    store.users.push({
      id: "user_admin",
      name: "Admin",
      phone: "",
      email,
      role: "admin",
      pinHash: hashPin(password),
      balanceKs: 0,
    });
    return true;
  }
  let changed = false;
  if (admin.email !== email) {
    admin.email = email;
    changed = true;
  }
  if (admin.pinHash !== hashPin(password)) {
    admin.pinHash = hashPin(password);
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
    const defaultPkg = GAME_MODULES.flatMap((m) => m.packages).find(
      (p) => p.id === pkg.id || (p.smileGoodsId && p.smileGoodsId === pkg.smileGoodsId),
    );
    if (defaultPkg) {
      if (typeof pkg.smileCoin !== "number" || Number.isNaN(pkg.smileCoin) || pkg.smileCoin === 0) {
        pkg.smileCoin = defaultPkg.smileCoin;
      }
      if (!pkg.smileGoodsId && defaultPkg.smileGoodsId) {
        pkg.smileGoodsId = defaultPkg.smileGoodsId;
      }
    } else if (typeof pkg.smileCoin !== "number" || Number.isNaN(pkg.smileCoin)) {
      pkg.smileCoin = 0;
    }
  }
}
