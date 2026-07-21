"""Accept / Decline payment proofs from the admin Telegram group."""

from __future__ import annotations

import logging

from telegram import ForceReply, Update
from telegram.ext import (
    ApplicationHandlerStop,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import database as db
from bot import config
from bot import i18n
from bot.handlers.admin import is_admin
from bot.keyboards import main_menu_keyboard
from services.order_fulfill import approve_and_topup
from services.payment_proofs import update_order_proof

logger = logging.getLogger("cloud_gameshop.group_payment")


def _parse_proof_order_id(data: str, prefix: str) -> int | None:
    if not data.startswith(prefix):
        return None
    tail = data[len(prefix) :]
    if not tail.isdigit():
        return None
    return int(tail)


async def _answer_callback(query, text: str | None = None, *, alert: bool = False) -> None:
    try:
        if alert:
            await query.answer(text or "…", show_alert=True)
        elif text:
            await query.answer(text)
        else:
            await query.answer()
    except Exception:
        logger.exception("callback answer failed for data=%r", query.data)


def _callback_chat_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is not None:
        chat = getattr(msg, "chat", None)
        if chat is not None and getattr(chat, "id", None) is not None:
            return int(chat.id)
        cid = getattr(msg, "chat_id", None)
        if cid is not None:
            return int(cid)
    chat = update.effective_chat
    return chat.id if chat else None


def _callback_message_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is None:
        return None
    mid = getattr(msg, "message_id", None)
    return int(mid) if mid is not None else None


def _callback_thread_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is None:
        return None
    tid = getattr(msg, "message_thread_id", None)
    return int(tid) if tid is not None else None


async def _group_reply(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    *,
    reply_markup=None,
) -> None:
    chat_id = _callback_chat_id(update)
    if not chat_id:
        logger.error(
            "Cannot reply to group callback — no chat id (data=%r)",
            getattr(update.callback_query, "data", None),
        )
        return
    kwargs: dict = {"chat_id": chat_id, "text": text}
    thread_id = _callback_thread_id(update)
    if thread_id is not None:
        kwargs["message_thread_id"] = thread_id
    reply_to = _callback_message_id(update)
    if reply_to is not None:
        kwargs["reply_to_message_id"] = reply_to
    if reply_markup is not None:
        kwargs["reply_markup"] = reply_markup
    try:
        await context.bot.send_message(**kwargs)
    except Exception:
        logger.exception("group reply failed chat=%s text=%r", chat_id, text[:80])


async def proof_accept_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    query = update.callback_query
    if not query:
        return

    order_id = _parse_proof_order_id(query.data or "", "proof_ok_")
    if order_id is None:
        await _answer_callback(query, "Invalid button", alert=True)
        raise ApplicationHandlerStop

    user = update.effective_user
    if not user or not is_admin(user.id):
        await _answer_callback(query, "Access denied — admin only", alert=True)
        raise ApplicationHandlerStop

    order = await db.get_order(order_id)
    if not order or order["status"] != "manual_review":
        await _answer_callback(query, "Order already processed", alert=True)
        raise ApplicationHandlerStop

    await _answer_callback(query, "Accepting…")
    logger.info("Group accept order #%s by admin %s", order_id, user.id)

    try:
        ok, msg = await approve_and_topup(
            context.bot, order_id, processed_by=user.id
        )
    except Exception:
        logger.exception("Group accept failed for order %s", order_id)
        await _group_reply(update, context, f"Accept failed: internal error (#{order_id})")
        raise ApplicationHandlerStop

    if ok:
        await _group_reply(update, context, f"Order #{order_id} accepted.")
    else:
        await _group_reply(update, context, f"Accept finished with error: {msg}")
    raise ApplicationHandlerStop


async def proof_decline_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    query = update.callback_query
    if not query:
        return

    order_id = _parse_proof_order_id(query.data or "", "proof_no_")
    if order_id is None:
        await _answer_callback(query, "Invalid button", alert=True)
        raise ApplicationHandlerStop

    user = update.effective_user
    if not user or not is_admin(user.id):
        await _answer_callback(query, "Access denied — admin only", alert=True)
        raise ApplicationHandlerStop

    order = await db.get_order(order_id)
    if not order or order["status"] != "manual_review":
        await _answer_callback(query, "Order already processed", alert=True)
        raise ApplicationHandlerStop

    await _answer_callback(query)
    logger.info("Group decline order #%s by admin %s", order_id, user.id)
    context.chat_data["group_reject_order_id"] = order_id
    context.user_data["group_reject_order_id"] = order_id

    await _group_reply(
        update,
        context,
        f"Reply with a decline reason for order #{order_id}.",
        reply_markup=ForceReply(
            selective=True,
            input_field_placeholder="Decline reason",
        ),
    )
    raise ApplicationHandlerStop


async def group_reject_reason(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Capture decline reason typed as a reply in the proofs group."""
    order_id = context.chat_data.get("group_reject_order_id")
    if not order_id:
        order_id = context.user_data.get("group_reject_order_id")
    if not order_id:
        return

    user = update.effective_user
    if not user or not is_admin(user.id) or not update.message:
        return

    reason = (update.message.text or "").strip() or "—"
    context.chat_data.pop("group_reject_order_id", None)
    context.user_data.pop("group_reject_order_id", None)

    await reject_order_from_group(update.get_bot(), int(order_id), user.id, reason)
    await update.message.reply_text(f"Order #{order_id} declined.")
    raise ApplicationHandlerStop


async def reject_order_from_group(
    bot,
    order_id: int,
    admin_id: int,
    reason: str,
) -> None:
    order = await db.reject_order(order_id, admin_id, reason)
    if not order:
        return

    await update_order_proof(
        bot,
        order_id,
        "rejected",
        note=f"Reason: {reason}",
    )

    telegram_id = int(order["telegram_id"])
    lang = i18n.normalize_lang(order.get("user_language"))
    try:
        await bot.send_message(
            telegram_id,
            i18n.t("payment_rejected", lang, reason=reason),
            reply_markup=main_menu_keyboard(lang),
        )
    except Exception:
        logger.exception("notify user reject failed for order %s", order_id)


def _proofs_group_reject_filter():
    base = filters.TEXT & ~filters.COMMAND & filters.REPLY
    gid = config.PAYMENTS_PROOFS_GROUP_ID
    if gid:
        return base & filters.Chat(gid)
    return base & filters.ChatType.GROUPS


def build_group_payment_handlers() -> list:
    return [
        CallbackQueryHandler(proof_accept_callback, pattern=r"^proof_ok_\d+$"),
        CallbackQueryHandler(proof_decline_callback, pattern=r"^proof_no_\d+$"),
        MessageHandler(_proofs_group_reject_filter(), group_reject_reason),
    ]
