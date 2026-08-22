import type { Context } from "grammy";
import { formatKs, salePriceKs } from "@/lib/format";
import { readStore, updateStore } from "@/lib/store";
import { getGameById } from "@/games/shared/catalog";
import { createDeposit, failedStatus, listPaymentMethods, paidStatus, verifyDepositLast5 } from "@/lib/dominate";
import { paySmileoneMlbb, validateSmileonePackageAvailability } from "@/lib/smileone";
import { loadShopEnv } from "@/lib/shop-env";
import type { Order, Transaction } from "@/lib/types";
import { DEFAULT_LANG, t } from "./i18n";
import {
  cancelKeyboard,
  confirmAccountKeyboard,
  gamesKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
  packagesKeyboard,
  paymentMethodsKeyboard,
  savedAccountsKeyboard,
} from "./keyboards";
import type { BotLanguage, BotSession, BotStep } from "./types";

const sessions = new Map<number, BotSession>();
const MAX_SESSIONS = 5000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function pruneStaleSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [userId, s] of sessions.entries()) {
    const updated = Date.parse(s.updatedAt || "");
    if (!Number.isFinite(updated) || updated < cutoff) {
      sessions.delete(userId);
    }
  }
  if (sessions.size > MAX_SESSIONS) {
    const entries = [...sessions.entries()].sort((a, b) =>
      (a[1].updatedAt || "").localeCompare(b[1].updatedAt || ""),
    );
    const removeCount = sessions.size - MAX_SESSIONS;
    for (let i = 0; i < removeCount; i++) {
      sessions.delete(entries[i][0]);
    }
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(pruneStaleSessions, 60 * 60 * 1000).unref?.();
}

export function getSession(userId: number, chatId: number): BotSession {
  let s = sessions.get(userId);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      pruneStaleSessions();
    }
    s = {
      telegramId: userId,
      chatId,
      language: DEFAULT_LANG,
      step: "idle",
      savedAccounts: [],
      updatedAt: new Date().toISOString(),
    };
    sessions.set(userId, s);
  } else {
    s.updatedAt = new Date().toISOString();
  }
  return s;
}

export function setStep(session: BotSession, step: BotStep) {
  session.step = step;
  session.updatedAt = new Date().toISOString();
}

export async function handleStart(ctx: Context) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  const session = getSession(userId, chatId);
  session.step = "idle";
  session.pendingOrderId = undefined;
  session.depositId = undefined;

  // Clear legacy reply keyboard if present in Telegram client
  try {
    const clearing = await ctx.reply("⏳", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.api.deleteMessage(chatId, clearing.message_id).catch(() => {});
  } catch {
    // ignore
  }

  await ctx.reply(t("welcome", session.language), {
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard(session.language),
  });
}

export async function handleHelp(ctx: Context) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  await ctx.reply(t("help", session.language), {
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard(session.language),
  });
}

export async function handleCancel(ctx: Context) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  session.step = "idle";
  session.pendingOrderId = undefined;
  session.depositId = undefined;

  await ctx.reply(t("order_cancelled", session.language), {
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard(session.language),
  });
}

export async function handleShop(ctx: Context) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const activeGames = store.games.filter((g) => g.isActive);

  if (activeGames.length === 0) {
    await ctx.reply("No games currently active. Please check back soon!", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  setStep(session, "select_game");
  await ctx.reply(t("choose_game", session.language), {
    parse_mode: "Markdown",
    reply_markup: gamesKeyboard(activeGames, session.language),
  });
}

export async function handleGameSelect(ctx: Context, gameId: string, page: number = 0) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const game = store.games.find((g) => g.id === gameId);

  if (!game || !game.isActive) {
    await ctx.reply("Game not found or inactive.", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  session.gameId = gameId;
  const packages = store.packages
    .filter((p) => p.gameId === gameId && p.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (packages.length === 0) {
    await ctx.reply("No packages available for this game.", {
      reply_markup: gamesKeyboard(store.games.filter((g) => g.isActive), session.language),
    });
    return;
  }

  setStep(session, "select_package");
  const text = t("choose_package", session.language, { game: game.name });
  const replyMarkup = packagesKeyboard(packages, page, session.language, gameId);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      });
      return;
    } catch {
      // Continue to reply if edit fails
    }
  }

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: replyMarkup,
  });
}

export async function handlePackageSelect(ctx: Context, pkgId: string) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const pkg = store.packages.find((p) => p.id === pkgId);

  if (!pkg || !pkg.isActive) {
    await ctx.reply("Selected package is no longer available.", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  // Pre-check Smile.one supplier balance availability
  const check = await validateSmileonePackageAvailability(pkg);
  if (!check.ok) {
    await ctx.reply(check.error || "Package is currently unavailable.", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  session.packageId = pkgId;
  session.amountKs = salePriceKs(pkg);

  const game = store.games.find((g) => g.id === session.gameId);
  const savedForGame = session.savedAccounts.filter((a) => a.gameId === session.gameId);

  if (savedForGame.length > 0) {
    setStep(session, "enter_game_id");
    await ctx.reply("Select a saved account or enter a new one:", {
      reply_markup: savedAccountsKeyboard(savedForGame, session.language),
    });
    return;
  }

  setStep(session, "enter_game_id");
  const isMlbb = game?.slug === "mlbb" || game?.id === "mlbb";
  await ctx.reply(
    t("enter_game_id", session.language, {
      format: isMlbb ? "GameID(ServerID)" : "GameID",
      example: isMlbb ? "450215964(2353)" : "12345678",
    }),
    {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard(session.language),
    },
  );
}

export async function handleGameIdInput(ctx: Context, text: string) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const raw = text.trim();

  let gameUserId = "";
  let zoneId = "";

  const match = raw.match(/^(\d+)[\s(]+(\d+)\)?$/);
  if (match && match[1] && match[2]) {
    gameUserId = match[1];
    zoneId = match[2];
  } else if (/^\d+$/.test(raw)) {
    gameUserId = raw;
    zoneId = "";
  } else {
    await ctx.reply(t("invalid_game_id", session.language, { example: "450215964(2353)" }), {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard(session.language),
    });
    return;
  }

  await performAccountVerification(ctx, session, gameUserId, zoneId);
}

export async function performAccountVerification(
  ctx: Context,
  session: BotSession,
  gameUserId: string,
  zoneId: string,
) {
  const store = await readStore();
  const game = store.games.find((g) => g.id === session.gameId);
  const pkg = store.packages.find((p) => p.id === session.packageId);

  if (!game || !pkg) {
    await ctx.reply("Session expired. Please start again.", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  await ctx.reply(t("checking_account", session.language));

  let nickname = "Player";
  let region = "Myanmar";

  const gameModule = getGameById(game.id);
  if (gameModule?.verify) {
    try {
      const verified = await gameModule.verify({ gameUserId, zoneId });
      nickname = verified.nickname;
      region = verified.region || "Myanmar";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Account not found.";
      await ctx.reply(`${msg}\nPlease verify your Game ID and Server and try again.`, {
        reply_markup: cancelKeyboard(session.language),
      });
      return;
    }
  }

  session.gameUserId = gameUserId;
  session.zoneId = zoneId;
  session.nickname = nickname;
  session.region = region;

  if (!session.savedAccounts.some((a) => a.gameUserId === gameUserId && a.zoneId === zoneId)) {
    session.savedAccounts.push({
      gameId: game.id,
      gameUserId,
      zoneId,
      nickname,
      savedAt: new Date().toISOString(),
    });
  }

  setStep(session, "confirm_account");
  await ctx.reply(
    t("account_verified", session.language, {
      nickname,
      gameUserId,
      zoneId: zoneId || "Global",
      region,
      packageName: pkg.displayName,
      amountKs: formatKs(session.amountKs || salePriceKs(pkg)),
    }),
    {
      parse_mode: "Markdown",
      reply_markup: confirmAccountKeyboard(session.language),
    },
  );
}

export async function handlePaymentSelect(ctx: Context) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const pkg = store.packages.find((p) => p.id === session.packageId);

  if (pkg) {
    const check = await validateSmileonePackageAvailability(pkg);
    if (!check.ok) {
      await ctx.reply(check.error || "Package is currently unavailable.", {
        reply_markup: mainMenuKeyboard(session.language),
      });
      return;
    }
  }

  const methods = await listPaymentMethods();

  const options = methods.map((m) => ({ id: m.id, name: `${m.method} (${m.accountName || m.accountNumber})` }));
  if (options.length === 0) {
    options.push(
      { id: "direct_kbz", name: "KBZPay (Direct)" },
      { id: "direct_wave", name: "WavePay (Direct)" },
    );
  }

  setStep(session, "choose_payment");
  await ctx.reply(t("choose_payment", session.language), {
    parse_mode: "Markdown",
    reply_markup: paymentMethodsKeyboard(options, session.language),
  });
}

export async function handleCreateOrderAndDeposit(ctx: Context, methodId: string) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const game = store.games.find((g) => g.id === session.gameId);
  const pkg = store.packages.find((p) => p.id === session.packageId);

  if (!game || !pkg || !session.gameUserId || !session.amountKs) {
    await ctx.reply("Order session expired. Tap /start to begin.", {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  const orderId = `tg_${Date.now().toString(36)}`;
  let depositId: string | null = null;
  let accountName = "Cloud Game Shop";
  let accountNumber = "09970000000";
  let methodName = "KBZPay";

  const methods = await listPaymentMethods();
  const selected = methods.find((m) => m.id === methodId);

  let qrPngBase64: string | null = null;
  let qrPayload: string | null = null;

  if (selected) {
    methodName = selected.method;
    accountName = selected.accountName;
    accountNumber = selected.accountNumber;
    try {
      const deposit = await createDeposit({
        accountId: selected.id,
        amountKs: session.amountKs,
        orderId,
      });
      depositId = deposit.id;
      qrPngBase64 = deposit.qr_png_base64 || null;
      qrPayload = deposit.qr_payload || null;
    } catch {
      // Fallback to direct instructions if deposit create failed
    }
  }

  const newOrder: Order = {
    id: orderId,
    userId: `tg_${session.telegramId}`,
    gameId: game.id,
    gameName: game.name,
    packageId: pkg.id,
    packageName: pkg.displayName,
    amountKs: session.amountKs,
    gameUserId: session.gameUserId,
    zoneId: session.zoneId || "",
    nickname: session.nickname || "Player",
    region: session.region || "Myanmar",
    status: "awaiting_payment",
    paymentMethod: methodName,
    depositId,
    payeeName: accountName,
    payeePhone: accountNumber,
    qrPngBase64,
    qrPayload,
    txid: null,
    failReason: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  await updateStore((s) => {
    s.orders.push(newOrder);
  });

  session.pendingOrderId = orderId;
  session.depositId = depositId || undefined;
  session.payMethod = methodName;
  setStep(session, "awaiting_last5");

  const replyText = t("payment_instructions", session.language, {
    method: methodName,
    amountKs: formatKs(session.amountKs),
    accountName,
    accountNumber,
    orderId,
  });

  try {
    await ctx.reply(replyText, {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard(session.language),
    });
  } catch (err) {
    console.error("Failed to send markdown payment instructions, falling back to plain text:", err);
    await ctx.reply(replyText, {
      reply_markup: cancelKeyboard(session.language),
    });
  }
}

export async function handleLast5Input(ctx: Context, last5Raw: string) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const last5 = last5Raw.replace(/\D/g, "").slice(0, 5);

  if (last5.length !== 5) {
    await ctx.reply(t("invalid_game_id", session.language, { example: "12345" }), {
      reply_markup: cancelKeyboard(session.language),
    });
    return;
  }

  const orderId = session.pendingOrderId;
  if (!orderId) {
    await ctx.reply(t("no_open_order", session.language), {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  await ctx.reply(t("checking_payment", session.language));

  let txid = `TX${last5}${Date.now().toString().slice(-4)}`;
  let isSuccess = false;
  let failReason = "";

  const isDev = process.env.NODE_ENV !== "production";

  if (session.depositId) {
    try {
      const deposit = await verifyDepositLast5(session.depositId, last5);
      const st = String(deposit.status || "");
      txid = String(deposit.matched_order_id || deposit.bank_trx_id || deposit.trx_id || txid);
      if (paidStatus(st)) {
        isSuccess = true;
      } else if (failedStatus(st)) {
        isSuccess = false;
        failReason = deposit.verify_reason || "Payment declined or expired.";
      } else {
        await ctx.reply("Payment pending. Please transfer the exact amount and send the last 5 digits again.", {
          reply_markup: cancelKeyboard(session.language),
        });
        return;
      }
    } catch (err: unknown) {
      const errObj = err as { status?: number; isProviderBusy?: boolean; message?: string };
      if (errObj?.status === 503 || errObj?.isProviderBusy) {
        await ctx.reply("⏳ Payment provider is currently busy or synchronizing. Please wait a few seconds and send the last 5 digits again.", {
          reply_markup: cancelKeyboard(session.language),
        });
        return;
      }
      failReason = err instanceof Error ? err.message : "Gateway verification failed.";
    }
  } else {
    // Direct payment mode without gateway
    if (isDev && last5 === "00000") {
      isSuccess = false;
      failReason = "Payment was declined.";
    } else if (isDev) {
      isSuccess = true;
    } else {
      // In production, unverified direct payment requires manual admin review
      isSuccess = false;
      failReason = "Direct payment submitted - awaiting manual verification";
    }
  }

  let finalOrder: Order | null = null;
  const isDirectProdSubmission = !session.depositId && !isDev;
  const topupResult = {
    attempted: false,
    ok: false,
    message: "",
  };

  if (isSuccess) {
    const store = await readStore();
    const orderBefore = store.orders.find((o) => o.id === orderId);
    if (orderBefore && orderBefore.gameId === "mlbb") {
      const pkg = store.packages.find((p) => p.id === orderBefore.packageId);
      if (pkg?.smileGoodsId) {
        topupResult.attempted = true;
        const res = await paySmileoneMlbb({
          gameUserId: orderBefore.gameUserId,
          zoneId: orderBefore.zoneId,
          smileGoodsId: pkg.smileGoodsId,
        });
        topupResult.ok = res.ok;
        topupResult.message = res.message;
      }
    }
  }

  await updateStore(async (s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) return;

    if (isDirectProdSubmission) {
      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}`,
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: order.paymentMethod,
        txid,
        status: "pending",
        note: "Direct payment submission - awaiting admin review",
        createdAt: new Date().toISOString(),
      };
      s.transactions.push(txn);
      order.status = "processing";
      order.txid = txid;
      order.failReason = "Direct payment - awaiting admin verification";
      order.completedAt = null;
      finalOrder = order;
      return;
    }

    const txn: Transaction = {
      id: `txn_${Date.now().toString(36)}`,
      orderId: order.id,
      userId: order.userId,
      amountKs: order.amountKs,
      method: order.paymentMethod,
      txid,
      status: isSuccess ? "succeeded" : "failed",
      note: isSuccess ? `${order.paymentMethod} verified` : failReason,
      createdAt: new Date().toISOString(),
    };
    s.transactions.push(txn);

    if (!isSuccess) {
      order.status = "failed";
      order.txid = txid;
      order.failReason = failReason;
      order.completedAt = new Date().toISOString();
    } else {
      order.txid = txid;
      order.completedAt = new Date().toISOString();
      if (topupResult.attempted) {
        if (topupResult.ok) {
          order.status = "success";
          order.failReason = null;
        } else {
          // Payment received, but automated delivery failed -> processing for manual fulfillment
          order.status = "processing";
          order.failReason = `Auto-topup failed: ${topupResult.message}`;
        }
      } else {
        // Non-automated game or package -> processing for manual fulfillment
        order.status = "processing";
        order.failReason = "Awaiting manual fulfillment";
      }
    }
    finalOrder = order;
  });

  if (isDirectProdSubmission && finalOrder) {
    const fo = finalOrder as Order;
    session.step = "idle";
    session.pendingOrderId = undefined;
    session.depositId = undefined;

    await ctx.reply(
      t("payment_paid_topup_pending", session.language, {
        nickname: fo.nickname,
        gameName: fo.gameName,
        packageName: fo.packageName,
        orderId: fo.id,
        txid: fo.txid || txid,
      }),
      {
        parse_mode: "Markdown",
        reply_markup: mainMenuKeyboard(session.language),
      },
    );

    await notifyAdminsManualTopup(
      ctx.api,
      fo,
      "Direct payment submitted on Telegram - awaiting manual verification",
    );
    return;
  }

  if (isSuccess && finalOrder) {
    const fo = finalOrder as Order;
    session.step = "idle";
    session.pendingOrderId = undefined;
    session.depositId = undefined;

    if (fo.status === "success") {
      await ctx.reply(
        t("payment_success", session.language, {
          nickname: fo.nickname,
          gameName: fo.gameName,
          packageName: fo.packageName,
          orderId: fo.id,
          txid: fo.txid || txid,
        }),
        {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(session.language),
        },
      );
    } else {
      // Payment confirmed but awaiting manual delivery (e.g. dead PHPSESSID or non-auto game)
      await ctx.reply(
        t("payment_paid_topup_pending", session.language, {
          nickname: fo.nickname,
          gameName: fo.gameName,
          packageName: fo.packageName,
          orderId: fo.id,
          txid: fo.txid || txid,
        }),
        {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(session.language),
        },
      );

      // Alert admins & proofs group immediately!
      await notifyAdminsManualTopup(
        ctx.api,
        fo,
        topupResult.attempted ? topupResult.message : "Manual delivery required",
      );
    }
  } else {
    await ctx.reply(
      t("payment_failed", session.language, {
        reason: failReason || "Could not verify transaction.",
      }),
      {
        parse_mode: "Markdown",
        reply_markup: cancelKeyboard(session.language),
      },
    );
  }
}

export async function notifyAdminsManualTopup(
  api: Context["api"],
  order: Order,
  reason: string,
) {
  loadShopEnv();
  const proofGroupId = (process.env.PAYMENTS_PROOFS_GROUP_ID || "").trim();
  const adminIdsStr = (process.env.TELEGRAM_ADMIN_IDS || "").trim();
  const adminIds = adminIdsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const targets = new Set<string>();
  if (proofGroupId) targets.add(proofGroupId);
  for (const id of adminIds) targets.add(id);

  const alertText = [
    "*[MANUAL TOP-UP REQUIRED]*",
    `Payment confirmed, but automated delivery could not complete: \`${reason}\``,
    "",
    `*Order ID:* \`${order.id}\``,
    `*User / Nickname:* ${order.nickname || "—"}`,
    `*Game:* ${order.gameName} (\`${order.gameUserId}\`${order.zoneId ? ` (${order.zoneId})` : ""})`,
    `*Package:* ${order.packageName}`,
    `*Amount:* ${order.amountKs.toLocaleString()} Ks`,
    `*Payment Method:* ${order.paymentMethod} (\`${order.txid || "—"}\`)`,
    "",
    "Please manually fulfill this order or update the Smile.one session in the Admin panel.",
  ].join("\n");

  for (const target of targets) {
    try {
      await api.sendMessage(target, alertText, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.warn(`[Alert] Failed to notify target ${target}:`, err);
    }
  }
}

export async function handleHistory(ctx: Context) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  const store = await readStore();
  const userOrders = store.orders
    .filter((o) => o.userId === `tg_${session.telegramId}`)
    .slice(-10)
    .reverse();

  if (userOrders.length === 0) {
    await ctx.reply(t("history_empty", session.language), {
      reply_markup: mainMenuKeyboard(session.language),
    });
    return;
  }

  const lines = userOrders.map((o) =>
    t("history_item", session.language, {
      orderId: o.id,
      game: o.gameName,
      package: o.packageName,
      amount: formatKs(o.amountKs),
      status: o.status.toUpperCase(),
      date: new Date(o.createdAt).toLocaleDateString(),
    }),
  );

  await ctx.reply(`*Your Recent Orders:*\n\n${lines.join("\n\n")}`, {
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard(session.language),
  });
}

export async function handleLanguageMenu(ctx: Context) {
  await ctx.reply("Select your preferred language / ဘာသာစကား ရွေးချယ်ပါ:", {
    reply_markup: languageKeyboard(),
  });
}

export async function handleSetLanguage(ctx: Context, lang: BotLanguage) {
  const session = getSession(ctx.from!.id, ctx.chat!.id);
  session.language = lang;
  await ctx.reply(t("language_set", lang), {
    reply_markup: mainMenuKeyboard(lang),
  });
}
