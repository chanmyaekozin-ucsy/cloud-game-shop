import { InlineKeyboard } from "grammy";
import { formatKs, salePriceKs } from "@/lib/format";
import type { Game, Package } from "@/lib/types";
import type { BotLanguage, SavedAccount } from "./types";

export function mainMenuKeyboard(lang: BotLanguage = "my") {
  const isMy = lang === "my";
  return new InlineKeyboard()
    .text(isMy ? "💎 စျေးနှုန်းကြည့်ပြီး ဝယ်ယူမည်" : "💎 View Prices & Buy", "cmd:shop")
    .row()
    .text(isMy ? "📜 မှာယူမှု မှတ်တမ်း" : "📜 Order History", "cmd:history")
    .text(isMy ? "🌐 Language" : "🌐 ဘာသာစကား", "cmd:language")
    .row()
    .text(isMy ? "💬 အကူအညီရယူရန်" : "💬 Support & Help", "cmd:help");
}

export function languageKeyboard() {
  return new InlineKeyboard()
    .text("🇲🇲 မြန်မာဘာသာ", "setlang:my")
    .text("🇬🇧 English", "setlang:en")
    .row()
    .text("🔙 Back", "cmd:start");
}

export function gamesKeyboard(games: Game[], lang: BotLanguage = "my") {
  const kb = new InlineKeyboard();
  for (const game of games) {
    kb.text(`${game.icon || "🎮"} ${game.name}`, `game:${game.id}`).row();
  }
  kb.text(lang === "my" ? "🔙 ပင်မစာမျက်နှာ" : "🔙 Main Menu", "cmd:start");
  return kb;
}

export function packagesKeyboard(packages: Package[], lang: BotLanguage = "my") {
  const kb = new InlineKeyboard();
  for (let i = 0; i < packages.length; i += 2) {
    const p1 = packages[i];
    const p2 = packages[i + 1];
    if (p1) {
      const price1 = formatKs(salePriceKs(p1));
      const badge1 = p1.offPercent > 0 ? ` [${p1.offPercent}% OFF]` : "";
      kb.text(`${p1.displayName} - ${price1}${badge1}`, `pkg:${p1.id}`);
    }
    if (p2) {
      const price2 = formatKs(salePriceKs(p2));
      const badge2 = p2.offPercent > 0 ? ` [${p2.offPercent}% OFF]` : "";
      kb.text(`${p2.displayName} - ${price2}${badge2}`, `pkg:${p2.id}`);
    }
    kb.row();
  }
  kb.text(lang === "my" ? "🔙 ဂိမ်းရွေးချယ်မှုသို့" : "🔙 Back to Games", "cmd:shop");
  return kb;
}

export function confirmAccountKeyboard(lang: BotLanguage = "my") {
  const isMy = lang === "my";
  return new InlineKeyboard()
    .text(isMy ? "✅ အတည်ပြုပြီး ငွေပေးချေမည်" : "✅ Confirm & Pay", "act:confirm_account")
    .row()
    .text(isMy ? "🔄 ပြန်လည်ရိုက်ထည့်မည်" : "🔄 Re-enter ID", "act:reenter_id")
    .text(isMy ? "❌ ပယ်ဖျက်မည်" : "❌ Cancel", "cmd:cancel");
}

export function savedAccountsKeyboard(accounts: SavedAccount[], lang: BotLanguage = "my") {
  const kb = new InlineKeyboard();
  for (const acc of accounts) {
    kb.text(`👤 ${acc.nickname} (${acc.gameUserId})`, `savedacc:${acc.gameUserId}:${acc.zoneId}`).row();
  }
  kb.text(lang === "my" ? "✏️ အကောင့်အသစ် ရိုက်ထည့်မည်" : "✏️ Enter New Account", "act:enter_new_id").row();
  kb.text(lang === "my" ? "❌ ပယ်ဖျက်မည်" : "❌ Cancel", "cmd:cancel");
  return kb;
}

export function paymentMethodsKeyboard(
  methods: Array<{ id: string; name: string }>,
  lang: BotLanguage = "my",
) {
  const kb = new InlineKeyboard();
  for (const method of methods) {
    kb.text(`💳 ${method.name}`, `paymethod:${method.id}`).row();
  }
  kb.text(lang === "my" ? "❌ ပယ်ဖျက်မည်" : "❌ Cancel", "cmd:cancel");
  return kb;
}

export function cancelKeyboard(lang: BotLanguage = "my") {
  return new InlineKeyboard().text(lang === "my" ? "❌ ပယ်ဖျက်မည်" : "❌ Cancel", "cmd:cancel");
}
