import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Bot } from "grammy";
import { loadShopEnv } from "@/lib/shop-env";
import { getSmileSupplierStatus, type SmileSupplierStatus } from "@/lib/smileone";

export interface MonitorConfig {
  enabled: boolean;
  proofsGroupId: string;
  minSec: number;
  maxSec: number;
}

export function getMonitorConfig(): MonitorConfig {
  loadShopEnv();
  const enabledStr = (process.env.MONITOR_ENABLED ?? "true").trim().toLowerCase();
  const enabled = enabledStr === "true" || enabledStr === "1" || enabledStr === "yes";
  const proofsGroupId = (process.env.PAYMENTS_PROOFS_GROUP_ID ?? "").trim();
  const minSec = Math.max(10, parseInt(process.env.MONITOR_INTERVAL_MIN_SEC || "40", 10) || 40);
  const maxSec = Math.max(minSec, parseInt(process.env.MONITOR_INTERVAL_MAX_SEC || "120", 10) || 120);

  return {
    enabled,
    proofsGroupId,
    minSec,
    maxSec,
  };
}

function pinStatePath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "monitor_pin.json"),
    path.join(process.cwd(), "..", ".data", "monitor_pin.json"),
    path.join(process.cwd(), ".data", "monitor_pin.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const appData = path.join(process.cwd(), "data");
  if (existsSync(appData)) {
    return path.join(appData, "monitor_pin.json");
  }
  const parentData = path.join(process.cwd(), "..", ".data");
  if (existsSync(parentData)) {
    return path.join(parentData, "monitor_pin.json");
  }
  return path.join(process.cwd(), "data", "monitor_pin.json");
}

interface PinState {
  chat_id: number | string;
  message_id: number;
}

function loadPinState(): PinState | null {
  const file = pinStatePath();
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PinState;
    if (raw && raw.chat_id && raw.message_id) {
      return raw;
    }
  } catch {
    // Ignore read/parse error
  }
  return null;
}

function savePinState(chatId: number | string, messageId: number) {
  const file = pinStatePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          chat_id: typeof chatId === "string" && /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
          message_id: messageId,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  } catch (err) {
    console.error("[Monitor] Failed to save pin state:", err);
  }
}

export function formatMmtDate(d = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} MMT`;
}

export function formatMonitorMessage(
  status: SmileSupplierStatus,
  minSec: number,
  maxSec: number
): string {
  const nowMmt = formatMmtDate();
  const intervalStr = minSec === maxSec ? `${minSec}s` : `${minSec}–${maxSec}s`;

  const lines = [
    "Cloud Game Shop — Smile.one Balance",
    `Updated: ${nowMmt}`,
    `Refresh: ${intervalStr}`,
    "",
  ];

  if (status.error) {
    lines.push(`Smile.one: ${status.error} (Warning)`);
  } else {
    lines.push(`Smile.one: ${status.balance ?? "—"}`);
  }

  return lines.join("\n");
}

function getRandomDelaySec(minSec: number, maxSec: number): number {
  return Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
}

export async function updatePinnedStatus(
  bot: Bot,
  chatId: string | number,
  text: string
): Promise<void> {
  const state = loadPinState();
  const targetChatIdStr = String(chatId);

  if (state && String(state.chat_id) === targetChatIdStr) {
    try {
      await bot.api.editMessageText(chatId, state.message_id, text, {
        link_preview_options: { is_disabled: true },
      });
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("message is not modified")) {
        return;
      }
      console.warn(`[Monitor] Pin message edit failed (${msg}), sending new pinned message...`);
    }
  }

  try {
    const sent = await bot.api.sendMessage(chatId, text, {
      link_preview_options: { is_disabled: true },
    });

    try {
      await bot.api.pinChatMessage(chatId, sent.message_id, {
        disable_notification: true,
      });
    } catch (pinErr) {
      console.warn(
        "[Monitor] Posted monitor status but could not pin (bot needs pin permissions in group):",
        pinErr
      );
    }

    savePinState(chatId, sent.message_id);
  } catch (sendErr) {
    console.error("[Monitor] Failed to post monitor status to proofs group:", sendErr);
  }
}

export async function runMonitorTick(bot: Bot): Promise<void> {
  const config = getMonitorConfig();
  if (!config.proofsGroupId) return;

  const status = await getSmileSupplierStatus();
  const text = formatMonitorMessage(status, config.minSec, config.maxSec);

  await updatePinnedStatus(bot, config.proofsGroupId, text);

  if (status.error) {
    console.warn(`[Monitor] Tick warning: smile=${status.error}`);
  } else {
    console.log(`[Monitor] Tick OK — smile=${status.balance}`);
  }
}

export async function startBalanceMonitor(bot: Bot): Promise<void> {
  const config = getMonitorConfig();
  if (!config.enabled) {
    console.log("[Monitor] Smile.one balance monitor disabled (MONITOR_ENABLED=false).");
    return;
  }
  if (!config.proofsGroupId) {
    console.warn("[Monitor] MONITOR_ENABLED is true but PAYMENTS_PROOFS_GROUP_ID is unset — monitor skipped.");
    return;
  }

  console.log(
    `[Monitor] Smile.one balance monitor started (${config.minSec}–${config.maxSec}s random -> group ${config.proofsGroupId})`
  );

  // Small delay before initial tick
  await new Promise((resolve) => setTimeout(resolve, 5000));

  while (true) {
    try {
      await runMonitorTick(bot);
    } catch (err) {
      console.error("[Monitor] Balance monitor tick exception:", err);
    }

    const delaySec = getRandomDelaySec(config.minSec, config.maxSec);
    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
  }
}
