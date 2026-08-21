import { InlineKeyboard } from "grammy";
import { formatKs, salePriceKs } from "@/lib/format";
import type { Game, Package } from "@/lib/types";
import type { BotLanguage, SavedAccount } from "./types";

export function mainMenuKeyboard(lang: BotLanguage = "my") {
  const isMy = lang === "my";
  return new InlineKeyboard()
    .text(isMy ? "စျေးနှုန်းကြည့်ပြီး ဝယ်ယူမည်" : "View Prices & Buy", "cmd:shop")
    .row()
    .text(isMy ? "မှာယူမှု မှတ်တမ်း" : "Order History", "cmd:history")
    .text(isMy ? "ဘာသာစကား (Language)" : "Language", "cmd:language")
    .row()
    .text(isMy ? "အကူအညီရယူရန်" : "Support & Help", "cmd:help");
}

export function languageKeyboard() {
  return new InlineKeyboard()
    .text("မြန်မာဘာသာ", "setlang:my")
    .text("English", "setlang:en")
    .row()
    .text("Back", "cmd:start");
}

export function gamesKeyboard(games: Game[], lang: BotLanguage = "my") {
  const kb = new InlineKeyboard();
  for (const game of games) {
    kb.text(game.name, `game:${game.id}`).row();
  }
  kb.text(lang === "my" ? "ပင်မစာမျက်နှာ" : "Main Menu", "cmd:start");
  return kb;
}

export const PACKAGES_PER_PAGE = 6;

export function packagesKeyboard(
  packages: Package[],
  pageOrLang: number | BotLanguage = 0,
  lang: BotLanguage = "my",
  gameId?: string,
) {
  let page = 0;
  let currentLang = lang;
  if (typeof pageOrLang === "string") {
    currentLang = pageOrLang as BotLanguage;
    page = 0;
  } else {
    page = pageOrLang;
  }

  const effectiveGameId = gameId || packages[0]?.gameId || "";
  const totalPages = Math.max(1, Math.ceil(packages.length / PACKAGES_PER_PAGE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * PACKAGES_PER_PAGE;
  const pageItems = packages.slice(start, start + PACKAGES_PER_PAGE);

  const kb = new InlineKeyboard();
  // 1 column: each package on its own line
  for (const p of pageItems) {
    const price = formatKs(salePriceKs(p));
    const badge = p.offPercent > 0 ? ` [${p.offPercent}% OFF]` : "";
    kb.text(`${p.displayName} - ${price}${badge}`, `pkg:${p.id}`).row();
  }

  // Pagination navigation row if more than 1 page
  if (totalPages > 1) {
    if (currentPage > 0) {
      kb.text("< Prev", `pkgpage:${effectiveGameId}:${currentPage - 1}`);
    } else {
      kb.text("-", "noop");
    }

    kb.text(`${currentPage + 1} / ${totalPages}`, "noop");

    if (currentPage < totalPages - 1) {
      kb.text("Next >", `pkgpage:${effectiveGameId}:${currentPage + 1}`);
    } else {
      kb.text("-", "noop");
    }
    kb.row();
  }

  kb.text(currentLang === "my" ? "ဂိမ်းရွေးချယ်မှုသို့" : "Back to Games", "cmd:shop");
  return kb;
}

export function confirmAccountKeyboard(lang: BotLanguage = "my") {
  const isMy = lang === "my";
  return new InlineKeyboard()
    .text(isMy ? "အတည်ပြုပြီး ငွေပေးချေမည်" : "Confirm & Pay", "act:confirm_account")
    .row()
    .text(isMy ? "ပြန်လည်ရိုက်ထည့်မည်" : "Re-enter ID", "act:reenter_id")
    .text(isMy ? "ပယ်ဖျက်မည်" : "Cancel", "cmd:cancel");
}

export function savedAccountsKeyboard(accounts: SavedAccount[], lang: BotLanguage = "my") {
  const kb = new InlineKeyboard();
  for (const acc of accounts) {
    kb.text(`${acc.nickname} (${acc.gameUserId})`, `savedacc:${acc.gameUserId}:${acc.zoneId}`).row();
  }
  kb.text(lang === "my" ? "အကောင့်အသစ် ရိုက်ထည့်မည်" : "Enter New Account", "act:enter_new_id").row();
  kb.text(lang === "my" ? "ပယ်ဖျက်မည်" : "Cancel", "cmd:cancel");
  return kb;
}

export function paymentMethodsKeyboard(
  methods: Array<{ id: string; name: string }>,
  lang: BotLanguage = "my",
) {
  const kb = new InlineKeyboard();
  for (const method of methods) {
    kb.text(method.name, `paymethod:${method.id}`).row();
  }
  kb.text(lang === "my" ? "ပယ်ဖျက်မည်" : "Cancel", "cmd:cancel");
  return kb;
}

export function cancelKeyboard(lang: BotLanguage = "my") {
  return new InlineKeyboard().text(lang === "my" ? "ပယ်ဖျက်မည်" : "Cancel", "cmd:cancel");
}
