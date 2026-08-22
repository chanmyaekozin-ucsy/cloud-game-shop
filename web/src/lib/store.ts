import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { mergeCatalog, seedStore, syncAdminFromEnv } from "./seed";
import type { Order, Package, Store, Transaction, User } from "./types";

const AWAITING_PAYMENT_MS = 3 * 60 * 60 * 1000;

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function dbPath(): string {
  return process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(dataDir(), "store.sqlite3");
}

function legacyJsonPath(): string {
  return path.join(dataDir(), "store.json");
}

/**
 * Newest store.json backup produced by a previous migration
 * (store.json.migrated.<timestamp>). Used as a recovery path when the live
 * JSON is gone but SQLite has no data yet (e.g. a prior migration ran against
 * a disposable environment and the DB was lost).
 */
function newestLegacyBackupPath(): string | null {
  const dir = dataDir();
  if (!existsSync(dir)) return null;
  const backups = readdirSync(dir)
    .filter((f) => /^store\.json\.migrated\.\d+$/.test(f))
    .sort((a, b) => Number(b.split(".").pop()) - Number(a.split(".").pop()));
  return backups[0] ? path.join(dir, backups[0]) : null;
}

let db: Database.Database | null = null;

function openDb(): Database.Database {
  if (db) return db;
  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      pin_hash TEXT NOT NULL,
      balance_ks INTEGER NOT NULL DEFAULT 0,
      wathanpay_sub TEXT,
      avatar_url TEXT,
      two_factor_secret TEXT,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      last_used_totp_counter INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      tag TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      needs_verify INTEGER NOT NULL DEFAULT 0,
      id_label TEXT NOT NULL DEFAULT '',
      zone_label TEXT NOT NULL DEFAULT '',
      package_label TEXT NOT NULL DEFAULT '',
      fields_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      price_ks INTEGER NOT NULL DEFAULT 0,
      off_percent INTEGER NOT NULL DEFAULT 0,
      off_ks INTEGER NOT NULL DEFAULT 0,
      smile_goods_id TEXT NOT NULL DEFAULT '',
      smile_coin REAL NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      amount_ks INTEGER NOT NULL,
      game_user_id TEXT NOT NULL DEFAULT '',
      zone_id TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT '',
      deposit_id TEXT,
      payee_name TEXT,
      payee_phone TEXT,
      qr_png_base64 TEXT,
      qr_payload TEXT,
      txid TEXT,
      fail_reason TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_deposit ON orders(deposit_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount_ks INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      txid TEXT,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_txn_order ON transactions(order_id);
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (key, window_start)
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
  `);
}

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    name: String(r.name),
    phone: String(r.phone),
    email: String(r.email),
    role: r.role === "admin" ? "admin" : "user",
    pinHash: String(r.pin_hash),
    balanceKs: Number(r.balance_ks) || 0,
    wathanpaySub: r.wathanpay_sub == null ? undefined : String(r.wathanpay_sub),
    avatarUrl: r.avatar_url == null ? undefined : (String(r.avatar_url) || null),
    twoFactorSecret: r.two_factor_secret == null ? undefined : (String(r.two_factor_secret) || null),
    twoFactorEnabled: Number(r.two_factor_enabled) === 1,
    tokenVersion: Number(r.token_version) || 0,
    lastUsedTotpCounter: Number(r.last_used_totp_counter) || 0,
  };
}

function rowToOrder(r: Record<string, unknown>): Order {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    gameId: String(r.game_id),
    gameName: String(r.game_name),
    packageId: String(r.package_id),
    packageName: String(r.package_name),
    amountKs: Number(r.amount_ks) || 0,
    gameUserId: String(r.game_user_id),
    zoneId: String(r.zone_id),
    nickname: String(r.nickname),
    region: String(r.region),
    status: String(r.status) as Order["status"],
    paymentMethod: String(r.payment_method),
    depositId: r.deposit_id == null ? null : String(r.deposit_id),
    payeeName: r.payee_name == null ? null : String(r.payee_name),
    payeePhone: r.payee_phone == null ? null : String(r.payee_phone),
    qrPngBase64: r.qr_png_base64 == null ? null : String(r.qr_png_base64),
    qrPayload: r.qr_payload == null ? null : String(r.qr_payload),
    txid: r.txid == null ? null : String(r.txid),
    failReason: r.fail_reason == null ? null : String(r.fail_reason),
    createdAt: String(r.created_at),
    completedAt: r.completed_at == null ? null : String(r.completed_at),
  };
}

function rowToPackage(r: Record<string, unknown>): Package {
  return {
    id: String(r.id),
    gameId: String(r.game_id),
    name: String(r.name),
    displayName: String(r.display_name),
    priceKs: Number(r.price_ks) || 0,
    offPercent: Number(r.off_percent) || 0,
    offKs: Number(r.off_ks) || 0,
    smileGoodsId: String(r.smile_goods_id),
    smileCoin: Number(r.smile_coin) || 0,
    featured: Number(r.featured) === 1,
    isActive: Number(r.is_active) === 1,
    sortOrder: Number(r.sort_order) || 0,
  };
}

function rowToTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    userId: String(r.user_id),
    amountKs: Number(r.amount_ks) || 0,
    method: String(r.method),
    txid: r.txid == null ? null : String(r.txid),
    status: String(r.status) as Transaction["status"],
    note: String(r.note),
    createdAt: String(r.created_at),
  };
}

function expireStaleOrders(store: Store) {
  const cutoff = Date.now() - AWAITING_PAYMENT_MS;
  let changed = false;
  for (const order of store.orders) {
    if (order.status !== "awaiting_payment") continue;
    const created = Date.parse(order.createdAt);
    if (!Number.isFinite(created) || created > cutoff) continue;
    order.status = "failed";
    order.failReason = "Payment timed out after 3 hours.";
    order.completedAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

/**
 * Persist a full Store snapshot. Called after mutation callbacks and after
 * in-place normalizations (expiry, admin sync) so the DB always matches the
 * in-memory object the callback returned.
 */
function userRow(u: User) {
  return {
    id: u.id,
    name: u.name ?? "",
    phone: u.phone ?? "",
    email: u.email ?? "",
    role: u.role === "admin" ? "admin" : "user",
    pinHash: u.pinHash,
    balanceKs: Number.isFinite(u.balanceKs) ? Math.round(u.balanceKs) : 0,
    wathanpaySub: u.wathanpaySub ?? null,
    avatarUrl: u.avatarUrl ?? null,
    twoFactorSecret: u.twoFactorSecret ?? null,
    twoFactorEnabled: u.twoFactorEnabled ? 1 : 0,
    tokenVersion: u.tokenVersion ?? 0,
    lastUsedTotpCounter: u.lastUsedTotpCounter ?? 0,
  };
}

function gameRow(g: Store["games"][number]) {
  return {
    id: g.id,
    name: g.name ?? "",
    slug: g.slug ?? "",
    icon: g.icon ?? "",
    tag: g.tag ?? null,
    isActive: g.isActive ? 1 : 0,
    sortOrder: g.sortOrder ?? 0,
    needsVerify: g.needsVerify ? 1 : 0,
    idLabel: g.idLabel ?? "",
    zoneLabel: g.zoneLabel ?? "",
    packageLabel: g.packageLabel ?? "",
    fieldsJson: JSON.stringify(g.fields ?? []),
  };
}

function packageRow(p: Package) {
  return {
    id: p.id,
    gameId: p.gameId,
    name: p.name ?? "",
    displayName: p.displayName ?? p.name ?? "",
    priceKs: Number.isFinite(p.priceKs) ? Math.round(p.priceKs) : 0,
    offPercent: Number.isFinite(p.offPercent) ? Math.round(p.offPercent) : 0,
    offKs: Number.isFinite(p.offKs) ? Math.round(p.offKs) : 0,
    smileGoodsId: p.smileGoodsId ?? "",
    smileCoin: Number.isFinite(p.smileCoin) ? p.smileCoin : 0,
    featured: p.featured ? 1 : 0,
    isActive: p.isActive ? 1 : 0,
    sortOrder: p.sortOrder ?? 0,
  };
}

function orderRow(o: Order) {
  return {
    id: o.id,
    userId: o.userId,
    gameId: o.gameId,
    gameName: o.gameName ?? "",
    packageId: o.packageId,
    packageName: o.packageName ?? "",
    amountKs: Number.isFinite(o.amountKs) ? Math.round(o.amountKs) : 0,
    gameUserId: o.gameUserId ?? "",
    zoneId: o.zoneId ?? "",
    nickname: o.nickname ?? "",
    region: o.region ?? "",
    status: o.status,
    paymentMethod: o.paymentMethod ?? "",
    depositId: o.depositId ?? null,
    payeeName: o.payeeName ?? null,
    payeePhone: o.payeePhone ?? null,
    qrPngBase64: o.qrPngBase64 ?? null,
    qrPayload: o.qrPayload ?? null,
    txid: o.txid ?? null,
    failReason: o.failReason ?? null,
    createdAt: o.createdAt,
    completedAt: o.completedAt ?? null,
  };
}

function txnRow(t: Transaction) {
  return {
    id: t.id,
    orderId: t.orderId,
    userId: t.userId,
    amountKs: Number.isFinite(t.amountKs) ? Math.round(t.amountKs) : 0,
    method: t.method ?? "",
    txid: t.txid ?? null,
    status: t.status,
    note: t.note ?? "",
    createdAt: t.createdAt,
  };
}

function persistStore(database: Database.Database, store: Store) {
  const upsertUser = database.prepare(`
    INSERT INTO users (id, name, phone, email, role, pin_hash, balance_ks, wathanpay_sub, avatar_url, two_factor_secret, two_factor_enabled, token_version, last_used_totp_counter)
    VALUES (@id, @name, @phone, @email, @role, @pinHash, @balanceKs, @wathanpaySub, @avatarUrl, @twoFactorSecret, @twoFactorEnabled, @tokenVersion, @lastUsedTotpCounter)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, email=excluded.email, role=excluded.role,
      pin_hash=excluded.pin_hash, balance_ks=excluded.balance_ks, wathanpay_sub=excluded.wathanpay_sub,
      avatar_url=excluded.avatar_url,       two_factor_secret=excluded.two_factor_secret,
      two_factor_enabled=excluded.two_factor_enabled, token_version=excluded.token_version,
      last_used_totp_counter=excluded.last_used_totp_counter
  `);
  const upsertGame = database.prepare(`
    INSERT INTO games (id, name, slug, icon, tag, is_active, sort_order, needs_verify, id_label, zone_label, package_label, fields_json)
    VALUES (@id, @name, @slug, @icon, @tag, @isActive, @sortOrder, @needsVerify, @idLabel, @zoneLabel, @packageLabel, @fieldsJson)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, slug=excluded.slug, icon=excluded.icon, tag=excluded.tag,
      is_active=excluded.is_active, sort_order=excluded.sort_order, needs_verify=excluded.needs_verify,
      id_label=excluded.id_label, zone_label=excluded.zone_label, package_label=excluded.package_label,
      fields_json=excluded.fields_json
  `);
  const upsertPackage = database.prepare(`
    INSERT INTO packages (id, game_id, name, display_name, price_ks, off_percent, off_ks, smile_goods_id, smile_coin, featured, is_active, sort_order)
    VALUES (@id, @gameId, @name, @displayName, @priceKs, @offPercent, @offKs, @smileGoodsId, @smileCoin, @featured, @isActive, @sortOrder)
    ON CONFLICT(id) DO UPDATE SET
      game_id=excluded.game_id, name=excluded.name, display_name=excluded.display_name,
      price_ks=excluded.price_ks, off_percent=excluded.off_percent, off_ks=excluded.off_ks,
      smile_goods_id=excluded.smile_goods_id, smile_coin=excluded.smile_coin,
      featured=excluded.featured, is_active=excluded.is_active, sort_order=excluded.sort_order
  `);
  const upsertOrder = database.prepare(`
    INSERT INTO orders (id, user_id, game_id, game_name, package_id, package_name, amount_ks, game_user_id, zone_id, nickname, region, status, payment_method, deposit_id, payee_name, payee_phone, qr_png_base64, qr_payload, txid, fail_reason, created_at, completed_at)
    VALUES (@id, @userId, @gameId, @gameName, @packageId, @packageName, @amountKs, @gameUserId, @zoneId, @nickname, @region, @status, @paymentMethod, @depositId, @payeeName, @payeePhone, @qrPngBase64, @qrPayload, @txid, @failReason, @createdAt, @completedAt)
    ON CONFLICT(id) DO UPDATE SET
      user_id=excluded.user_id, game_id=excluded.game_id, game_name=excluded.game_name,
      package_id=excluded.package_id, package_name=excluded.package_name, amount_ks=excluded.amount_ks,
      game_user_id=excluded.game_user_id, zone_id=excluded.zone_id, nickname=excluded.nickname,
      region=excluded.region, status=excluded.status, payment_method=excluded.payment_method,
      deposit_id=excluded.deposit_id, payee_name=excluded.payee_name, payee_phone=excluded.payee_phone,
      qr_png_base64=excluded.qr_png_base64, qr_payload=excluded.qr_payload, txid=excluded.txid,
      fail_reason=excluded.fail_reason, created_at=excluded.created_at, completed_at=excluded.completed_at
  `);
  const upsertTxn = database.prepare(`
    INSERT INTO transactions (id, order_id, user_id, amount_ks, method, txid, status, note, created_at)
    VALUES (@id, @orderId, @userId, @amountKs, @method, @txid, @status, @note, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      order_id=excluded.order_id, user_id=excluded.user_id, amount_ks=excluded.amount_ks,
      method=excluded.method, txid=excluded.txid, status=excluded.status, note=excluded.note,
      created_at=excluded.created_at
  `);

  const run = database.transaction((s: Store) => {
    for (const u of s.users) upsertUser.run(userRow(u));
    for (const g of s.games) upsertGame.run(gameRow(g));
    for (const p of s.packages) upsertPackage.run(packageRow(p));
    for (const o of s.orders) upsertOrder.run(orderRow(o));
    for (const t of s.transactions) upsertTxn.run(txnRow(t));
  });
  run(store);
}

function storeFromDb(database: Database.Database): Store {
  const users = (database.prepare("SELECT * FROM users").all() as Record<string, unknown>[]).map(rowToUser);
  const games = (database.prepare("SELECT * FROM games ORDER BY sort_order").all() as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    icon: String(r.icon),
    tag: (r.tag == null ? null : String(r.tag)) as Store["games"][number]["tag"],
    isActive: Number(r.is_active) === 1,
    sortOrder: Number(r.sort_order) || 0,
    needsVerify: Number(r.needs_verify) === 1,
    idLabel: String(r.id_label),
    zoneLabel: String(r.zone_label),
    packageLabel: String(r.package_label),
    fields: JSON.parse(String(r.fields_json || "[]")),
  }));
  const packages = (database.prepare("SELECT * FROM packages ORDER BY sort_order").all() as Record<string, unknown>[]).map(rowToPackage);
  const orders = (database.prepare("SELECT * FROM orders ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(rowToOrder);
  const transactions = (database.prepare("SELECT * FROM transactions ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(rowToTransaction);
  return { users, games, packages, orders, transactions };
}

/**
 * One-time migration: import data/store.json (legacy format) into SQLite.
 * The JSON file is renamed (not deleted) as a backup. If the JSON is
 * unreadable, migration aborts loudly instead of silently reseeding.
 */
function importLegacyJson(database: Database.Database, jsonFile: string, label: string): boolean {
  if (!existsSync(jsonFile)) return false;

  let raw: string;
  try {
    raw = readFileSync(jsonFile, "utf8");
  } catch (err) {
    throw new Error(`[MIGRATE] Failed to read legacy ${jsonFile}: ${err}`);
  }

  let parsed: Store;
  try {
    parsed = JSON.parse(raw) as Store;
  } catch {
    const backup = `${jsonFile}.corrupted.${Date.now()}`;
    renameSync(jsonFile, backup);
    throw new Error(
      `[MIGRATE] Legacy ${jsonFile} is corrupted. It has been moved to ${backup}. Restore or repair it, then restart. Refusing to start with an empty store.`,
    );
  }

  console.log(`[MIGRATE] Importing legacy ${label} into ${dbPath()}...`);
  persistStore(database, parsed);
  const rotated = path.join(dataDir(), `store.json.migrated.${Date.now()}`);
  if (jsonFile !== rotated) {
    try {
      renameSync(jsonFile, rotated);
    } catch {
      // Same-name rotation (recovering the newest backup): leave it in place.
    }
  }
  console.log(`[MIGRATE] Legacy ${label} imported into SQLite.`);
  return true;
}

function bootstrap(database: Database.Database) {
  if (importLegacyJson(database, legacyJsonPath(), "store.json")) {
    finishBootstrap(database);
    return;
  }

  const userCount = (database.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (userCount === 0) {
    // No live JSON and empty DB: try the newest migration backup before
    // reseeding, so a lost/rotated database never silently drops user data.
    const backup = newestLegacyBackupPath();
    if (backup && importLegacyJson(database, backup, path.basename(backup))) {
      finishBootstrap(database);
      return;
    }
    console.log("[STORE] Empty database - seeding admin account from environment.");
    persistStore(database, seedStore());
  } else {
    const store = storeFromDb(database);
    if (syncAdminFromEnv(store)) persistStore(database, store);
  }
}

function finishBootstrap(database: Database.Database) {
  const store = storeFromDb(database);
  mergeCatalog(store);
  syncAdminFromEnv(store);
  persistStore(database, store);
}

let bootstrapped = false;

function ensureBootstrapped() {
  if (bootstrapped) return;
  const database = openDb();
  bootstrap(database);
  bootstrapped = true;
}

export async function readStore(): Promise<Store> {
  ensureBootstrapped();
  return storeFromDb(db!);
}

export function readStoreSync(): Store {
  ensureBootstrapped();
  const store = storeFromDb(db!);
  if (expireStaleOrders(store)) persistStore(db!, store);
  return store;
}

/**
 * Runs `fn` with a fresh snapshot, then persists the (possibly mutated)
 * snapshot in a single SQLite transaction. Serialized through a promise
 * queue so concurrent route handlers cannot interleave read-modify-write
 * cycles.
 */
let queue: Promise<unknown> = Promise.resolve();

export function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = async () => {
    ensureBootstrapped();
    const store = storeFromDb(db!);
    const result = await fn(store);
    persistStore(db!, store);
    return result;
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Append an admin action to the audit log. */
export function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    ensureBootstrapped();
    db!.prepare("INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)").run(
      actor,
      action,
      JSON.stringify(detail),
      new Date().toISOString(),
    );
  } catch (err) {
    console.error("[AUDIT] Failed to record audit entry:", err);
  }
}

/** Returns true if this event id was seen before (marks it seen otherwise). */
export function seenWebhookEvent(eventId: string): boolean {
  ensureBootstrapped();
  const inserted = db!
    .prepare("INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)")
    .run(eventId, new Date().toISOString());
  return inserted.changes === 0;
}

/**
 * Durable fixed-window rate counter backed by SQLite. Survives restarts and
 * is shared by every process pointing at the same database file. Expired
 * rows are pruned opportunistically; a periodic sweep keeps the table small.
 * Returns the count within the current window (including this hit), or null
 * when the store is unavailable (caller falls back to in-memory limiting).
 */
export function hitRateLimit(key: string, windowMs: number): number | null {
  try {
    ensureBootstrapped();
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = windowStart + windowMs;

    // Opportunistic prune (cheap with the expiry index; bounded by index scan).
    if (Math.random() < 0.02) {
      db!.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").run(now);
    }

    db!
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count, expires_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
      )
      .run(key, windowStart, expiresAt);
    const row = db!
      .prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?")
      .get(key, windowStart) as { count: number } | undefined;
    return row ? row.count : null;
  } catch (err) {
    console.error("[RATE-LIMIT] SQLite counter failed, falling back to memory:", err);
    return null;
  }
}

/** Increment a user's tokenVersion, revoking all previously issued JWTs. */
export async function bumpTokenVersion(userId: string) {
  return updateStore((store) => {
    const user = store.users.find((u) => u.id === userId);
    if (user) {
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    return user?.tokenVersion ?? 0;
  });
}

/** Keep a JSON export for tooling/backups without serving as live storage. */
export function exportJsonBackup() {
  ensureBootstrapped();
  const store = storeFromDb(db!);
  const file = path.join(dataDir(), `store-export.${Date.now()}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
  return file;
}
