import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { mergeCatalog, seedStore, syncAdminFromEnv } from "./seed";
import type { Store } from "./types";

const FILE = path.join(process.cwd(), "data", "store.json");
const AWAITING_PAYMENT_MS = 3 * 60 * 60 * 1000;

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

let queue: Promise<unknown> = Promise.resolve();

async function readRaw(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      const seeded = seedStore();
      await writeRaw(seeded);
      return seeded;
    }
    throw err;
  }

  try {
    const store = JSON.parse(raw) as Store;
    mergeCatalog(store);
    let dirty = expireStaleOrders(store);
    if (syncAdminFromEnv(store)) dirty = true;
    if (dirty) await writeRaw(store);
    return store;
  } catch (parseErr) {
    console.error("[CRITICAL] Failed to parse store.json. Preserving corrupted backup:", parseErr);
    const backupPath = `${FILE}.corrupted.${Date.now()}`;
    await writeFile(backupPath, raw, "utf8").catch(() => undefined);
    const seeded = seedStore();
    await writeRaw(seeded);
    return seeded;
  }
}

async function writeRaw(store: Store) {
  const dir = path.dirname(FILE);
  await mkdir(dir, { recursive: true });
  const tmpFile = `${FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmpFile, JSON.stringify(store, null, 2) + "\n", "utf8");
  await rename(tmpFile, FILE);
}

export function readStore(): Promise<Store> {
  const next = queue.then(readRaw, readRaw);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const store = await readRaw();
    const result = await fn(store);
    await writeRaw(store);
    return result;
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
