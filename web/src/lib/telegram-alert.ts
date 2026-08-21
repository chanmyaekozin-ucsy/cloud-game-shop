import { loadShopEnv } from "./shop-env";
import type { Order } from "./types";

export async function sendAdminManualTopupAlert(
  order: Order,
  reason: string
): Promise<void> {
  loadShopEnv();
  const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return;

  const proofGroupId = (process.env.PAYMENTS_PROOFS_GROUP_ID || "").trim();
  const adminIdsStr = (process.env.TELEGRAM_ADMIN_IDS || "").trim();
  const adminIds = adminIdsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const targets = new Set<string>();
  if (proofGroupId) targets.add(proofGroupId);
  for (const id of adminIds) targets.add(id);

  if (targets.size === 0) return;

  const alertText = [
    "⚠️ *[MANUAL TOP-UP REQUIRED]*",
    `Payment confirmed, but automated delivery could not complete: \`${reason}\``,
    "",
    `🆔 *Order ID:* \`${order.id}\``,
    `👤 *User / Nickname:* ${order.nickname || "—"}`,
    `🎮 *Game:* ${order.gameName} (\`${order.gameUserId}\`${order.zoneId ? ` (${order.zoneId})` : ""})`,
    `💎 *Package:* ${order.packageName}`,
    `💰 *Amount:* ${order.amountKs.toLocaleString()} Ks`,
    `💳 *Payment Method:* ${order.paymentMethod} (\`${order.txid || "—"}\`)`,
    "",
    "👉 Please manually fulfill this order or update the Smile.one session in the Admin panel.",
  ].join("\n");

  for (const target of targets) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: target,
          text: alertText,
          parse_mode: "Markdown",
        }),
      });
    } catch (err) {
      console.warn(`[Alert] Failed to notify target ${target}:`, err);
    }
  }
}
