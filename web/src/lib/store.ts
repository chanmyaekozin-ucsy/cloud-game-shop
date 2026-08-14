import { mkdir, readFile, writeFile } from "fs/promises";
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
  try {
    const raw = await readFile(FILE, "utf8");
    const store = JSON.parse(raw) as Store;
    mergeCatalog(store);
    let dirty = expireStaleOrders(store);
    if (syncAdminFromEnv(store)) dirty = true;
    if (dirty) await writeRaw(store);
    return store;
  } catch {
    const seeded = seedStore();
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(seeded, null, 2) + "\n", "utf8");
    return seeded;
  }
}

async function writeRaw(store: Store) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
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
