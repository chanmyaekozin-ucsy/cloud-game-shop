import { Bot } from "grammy";
import { loadShopEnv } from "@/lib/shop-env";
import {
  getSession,
  handleCancel,
  handleCreateOrderAndDeposit,
  handleGameIdInput,
  handleGameSelect,
  handleHelp,
  handleHistory,
  handleLanguageMenu,
  handleLast5Input,
  handlePackageSelect,
  handlePaymentSelect,
  handleSetLanguage,
  handleShop,
  handleStart,
  performAccountVerification,
  setStep,
} from "./handlers";
import { cancelKeyboard } from "./keyboards";
import { t } from "./i18n";
import { startBalanceMonitor } from "./monitor";

export function getBotToken() {
  loadShopEnv();
  return (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

export function createBot() {
  const token = getBotToken();
  if (!token) {
    throw new Error("BOT_TOKEN is required to start the Telegram bot.");
  }

  const bot = new Bot(token);

  // Commands
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("cancel", handleCancel);
  bot.command("history", handleHistory);
  bot.command("orders", handleHistory);
  bot.command("shop", handleShop);

  // Callback Queries
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (data === "cmd:start") return handleStart(ctx);
    if (data === "cmd:shop") return handleShop(ctx);
    if (data === "cmd:history") return handleHistory(ctx);
    if (data === "cmd:language") return handleLanguageMenu(ctx);
    if (data === "cmd:help") return handleHelp(ctx);
    if (data === "cmd:cancel") return handleCancel(ctx);

    if (data.startsWith("setlang:")) {
      const lang = data.replace("setlang:", "") as "my" | "en";
      return handleSetLanguage(ctx, lang);
    }

    if (data === "noop") return;

    if (data.startsWith("game:")) {
      const gameId = data.replace("game:", "");
      return handleGameSelect(ctx, gameId);
    }

    if (data.startsWith("pkgpage:")) {
      const parts = data.split(":");
      const gameId = parts[1] || "";
      const page = parseInt(parts[2] || "0", 10);
      return handleGameSelect(ctx, gameId, page);
    }

    if (data.startsWith("pkg:")) {
      const pkgId = data.replace("pkg:", "");
      return handlePackageSelect(ctx, pkgId);
    }

    if (data === "act:confirm_account") {
      return handlePaymentSelect(ctx);
    }

    if (data === "act:reenter_id" || data === "act:enter_new_id") {
      const session = getSession(ctx.from!.id, ctx.chat!.id);
      setStep(session, "enter_game_id");
      return ctx.reply(t("enter_game_id", session.language, { format: "GameID(Server)", example: "450215964(2353)" }), {
        parse_mode: "Markdown",
        reply_markup: cancelKeyboard(session.language),
      });
    }

    if (data.startsWith("savedacc:")) {
      const [, gameUserId, zoneId] = data.split(":");
      const session = getSession(ctx.from!.id, ctx.chat!.id);
      if (gameUserId) {
        return performAccountVerification(ctx, session, gameUserId, zoneId || "");
      }
    }

    if (data.startsWith("paymethod:")) {
      const methodId = data.replace("paymethod:", "");
      return handleCreateOrderAndDeposit(ctx, methodId);
    }
  });

  // Text messages router
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const session = getSession(userId, chatId);

    if (session.step === "enter_game_id") {
      return handleGameIdInput(ctx, text);
    }

    if (session.step === "awaiting_last5" || (session.pendingOrderId && /^\d{5}$/.test(text))) {
      return handleLast5Input(ctx, text);
    }

    // Handle legacy reply keyboard button clicks gracefully
    const lower = text.toLowerCase();
    if (lower.includes("plan") || text.includes("စျေးနှုန်း") || lower.includes("buy") || lower.includes("shop")) {
      return handleShop(ctx);
    }
    if (lower.includes("history") || text.includes("မှတ်တမ်း") || lower.includes("orders")) {
      return handleHistory(ctx);
    }
    if (lower.includes("admin") || lower.includes("help") || text.includes("အကူအညီ")) {
      return handleHelp(ctx);
    }
    if (lower.includes("lang") || text.includes("ဘာသာစကား") || text.includes("မြန်မာ") || lower.includes("english")) {
      return handleLanguageMenu(ctx);
    }

    // Default: show main menu & clear keyboard
    return handleStart(ctx);
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

export async function startBot() {
  const token = getBotToken();
  if (!token) {
    console.log("[Bot] BOT_TOKEN not provided, skipping Telegram bot start.");
    return;
  }
  const bot = createBot();
  console.log("[Bot] Starting Cloud Game Shop Telegram Bot...");
  await bot.start({
    drop_pending_updates: true,
    onStart: async (info) => {
      console.log(`[Bot] Cloud Game Shop Bot started as @${info.username}`);
      await bot.api
        .setMyCommands([
          { command: "start", description: "Main Menu (ပင်မစာမျက်နှာ)" },
          { command: "shop", description: "Buy Diamonds & Packages (ဝယ်ယူမည်)" },
          { command: "history", description: "Order History (မှာယူမှုမှတ်တမ်း)" },
          { command: "help", description: "Support & Help (အကူအညီ)" },
          { command: "cancel", description: "Cancel Order (ပယ်ဖျက်မည်)" },
        ])
        .catch(() => {});

      // Launch Smile.one balance monitor loop in background
      startBalanceMonitor(bot).catch((err) => {
        console.error("Balance monitor failed:", err);
      });
    },
  });
}

// Auto-run if executed directly
if (
  process.argv[1]?.includes("bot.ts") ||
  process.argv[1]?.includes("src/bot/bot.ts") ||
  process.argv[1]?.includes("dist/bot.js") ||
  process.argv[1]?.includes("bot.js")
) {
  startBot().catch((err) => {
    console.error("Failed to start bot:", err);
    process.exit(1);
  });
}
