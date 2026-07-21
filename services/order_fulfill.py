"""Manual Accept → Smile.one top-up (when KBZ auto-verify is unavailable)."""

from __future__ import annotations

import asyncio
import logging

from telegram import Bot

import database as db
from bot import i18n
from bot.keyboards import failure_contact_markup, main_menu_keyboard
from services.payment_proofs import update_order_proof
from services.topup import place_mlbb_order

logger = logging.getLogger("cloud_gameshop.fulfill")


async def approve_and_topup(
    bot: Bot,
    order_id: int,
    *,
    processed_by: int = 0,
) -> tuple[bool, str]:
    """Accept a manual_review order and place the MLBB top-up."""
    order = await db.claim_manual_order_for_processing(order_id, processed_by)
    if not order:
        return False, "Order not in manual review (already processed?)"

    # If we already resolved a full KBZ tx id, lock it in the shared ledger.
    tx_id = (order.get("kbz_trans_id") or "").strip()
    if tx_id and not await db.claim_kbz_trans(tx_id, order_id):
        await db.update_order(order_id, status="manual_review")
        await update_order_proof(
            bot,
            order_id,
            "manual_review",
            note="Transaction ID already used (shared claim)",
        )
        return False, "Transaction ID already used"

    await update_order_proof(
        bot,
        order_id,
        "approved",
        note=f"By admin {processed_by}",
    )

    telegram_id = int(order["telegram_id"])
    lang = i18n.normalize_lang(order.get("user_language"))

    try:
        await bot.send_message(
            telegram_id,
            i18n.t("payment_verified", lang),
        )
        await bot.send_message(
            telegram_id,
            i18n.t("topup_processing", lang),
        )
    except Exception:
        logger.exception("Failed to notify user %s of approve", telegram_id)

    try:
        msg = await asyncio.to_thread(
            place_mlbb_order,
            smile_goods_id=order["smile_goods_id"],
            game_id=order["game_id"],
            server_id=order["server_id"],
            package_name=order["package_name"],
        )
        await db.update_order(order_id, status="completed", verify_message=msg)
        await update_order_proof(bot, order_id, "completed", note=msg)
        try:
            await bot.send_message(
                telegram_id,
                i18n.t("payment_ok", lang),
                reply_markup=main_menu_keyboard(lang),
            )
        except Exception:
            logger.exception("Failed to notify user %s of completion", telegram_id)
        return True, "completed"
    except Exception as e:
        logger.exception("Manual approve top-up failed for order %s", order_id)
        await db.update_order(
            order_id, status="topup_failed", verify_message=str(e)
        )
        await update_order_proof(bot, order_id, "topup_failed", note=str(e))
        try:
            await bot.send_message(
                telegram_id,
                i18n.t("topup_failed", lang),
                reply_markup=failure_contact_markup(lang),
            )
        except Exception:
            logger.exception("Failed to notify user %s of top-up failure", telegram_id)
        return False, str(e)
