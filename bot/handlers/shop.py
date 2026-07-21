"""Shop purchase flow handlers."""

from __future__ import annotations

import asyncio
import logging
import re

from telegram import Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

import database as db
from bot import config
from bot import i18n
from bot.keyboards import (
    admin_contact_keyboard,
    confirm_keyboard,
    failure_contact_markup,
    kbz_copy_phone_keyboard,
    main_menu_keyboard,
    plans_inline,
)
from providers.smileone.client import SmileOneClient
from providers.smileone.mlbb import MlbbAccount
from providers.smileone.packages import load_package_lists
from services.kbz_payment import verify_last5_digits
from services.payment_proofs import post_order_proof
from services.topup import place_mlbb_order

logger = logging.getLogger("cloud_gameshop.shop")

GAME_ID_RE = re.compile(r"^(\d+)\((\d+)\)\s*$")
TX_SUFFIX_RE = re.compile(r"^\d{5}$")

STATE_KEY = "shop_state"
ORDER_KEY = "pending_order_id"
PLAN_KEY = "pending_plan"
LANG_KEY = "language"


def _input_text(update: Update) -> str:
    return (update.message.text or "").strip().splitlines()[0].strip()


async def _safe_edit_message_text(query, text: str, **kwargs) -> None:
    try:
        await query.edit_message_text(text, **kwargs)
    except BadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


def _clear_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop(STATE_KEY, None)
    context.user_data.pop(ORDER_KEY, None)
    context.user_data.pop(PLAN_KEY, None)


async def _cancel_open_awaiting_order(
    context: ContextTypes.DEFAULT_TYPE,
    user_db_id: int,
) -> str:
    """Cancel awaiting_payment order if any. Returns i18n key for reply."""
    open_order = await db.get_open_order_for_user(user_db_id)
    _clear_flow(context)
    if not open_order:
        return "nothing_to_cancel"
    if open_order["status"] == "manual_review":
        # Keep lock — admin Accept/Decline owns this order.
        context.user_data[ORDER_KEY] = open_order["id"]
        return "cannot_cancel_review"
    if open_order["status"] != "awaiting_payment":
        return "nothing_to_cancel"
    cancelled = await db.cancel_awaiting_payment_order(user_db_id)
    if not cancelled:
        return "nothing_to_cancel"
    return "order_cancelled"


async def _resolve_open_order(
    context: ContextTypes.DEFAULT_TYPE,
    user_db_id: int,
) -> int | None:
    """Load active order from memory or SQLite (survives bot restarts)."""
    stored = context.user_data.get(ORDER_KEY)
    if stored:
        order = await db.get_order(int(stored))
        if order and order["status"] in (
            "awaiting_payment",
            "manual_review",
            "processing",
        ):
            return int(stored)

    order = await db.get_open_order_for_user(user_db_id)
    if not order:
        return None

    context.user_data[ORDER_KEY] = order["id"]
    return int(order["id"])


def _lang(context: ContextTypes.DEFAULT_TYPE, user_row: dict | None = None) -> str:
    if user_row and user_row.get("language"):
        lang = i18n.normalize_lang(user_row["language"])
        context.user_data[LANG_KEY] = lang
        return lang
    stored = context.user_data.get(LANG_KEY)
    if stored:
        return i18n.normalize_lang(stored)
    return i18n.DEFAULT_LANG


def _plan_by_id(plan_id: int) -> dict | None:
    for p in load_package_lists():
        if int(p.get("id", 0)) == plan_id:
            return p
    return None


def _price_ks(raw: str) -> int:
    m = re.search(r"[\d,]+", str(raw or ""))
    if not m:
        return 0
    return int(m.group().replace(",", ""))


def _kbz_pay_instructions(amount_ks: int, lang: str) -> str:
    name = config.KBZ_PAY_DISPLAY_NAME or "Cloud Game Shop"
    phone = config.KBZ_PAY_PHONE or "—"
    return i18n.t(
        "kbz_pay",
        lang,
        amount=i18n.format_amount(amount_ks, lang),
        name=name,
        phone=phone,
    )


async def _cmd_start_impl(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.effective_user:
        return
    _clear_flow(context)
    user = update.effective_user
    row = await db.upsert_user(
        user.id,
        username=user.username,
        first_name=user.first_name,
    )
    lang = _lang(context, row)
    await update.message.reply_text(
        i18n.t("welcome", lang),
        reply_markup=main_menu_keyboard(lang),
    )


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.effective_user:
        return
    logger.info("cmd_start update=%s user=%s", update.update_id, update.effective_user.id)
    await _cmd_start_impl(update, context)


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.effective_user:
        return
    user = update.effective_user
    row = await db.upsert_user(
        user.id,
        username=user.username,
        first_name=user.first_name,
    )
    lang = _lang(context, row)
    key = await _cancel_open_awaiting_order(context, row["id"])
    markup = (
        failure_contact_markup(lang)
        if key == "cannot_cancel_review"
        else main_menu_keyboard(lang)
    )
    await update.message.reply_text(i18n.t(key, lang), reply_markup=markup)


async def menu_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.effective_user:
        return
    text = _input_text(update)
    logger.info(
        "menu_message update=%s user=%s text=%r",
        update.update_id,
        update.effective_user.id,
        text,
    )

    if text.lower() in {"/start", "start"}:
        await _cmd_start_impl(update, context)
        return

    row = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    lang = _lang(context, row)

    button = i18n.menu_button_key(text)
    if button == "plans":
        await _show_plans(update, context, lang)
        return
    if button == "history":
        await _show_history(update, context, lang)
        return
    if button == "admin":
        markup = admin_contact_keyboard(lang)
        await update.message.reply_text(
            i18n.t("admin", lang, admin=config.admin_contact_label()),
            reply_markup=markup or main_menu_keyboard(lang),
        )
        return
    if button == "language":
        target = i18n.language_target_lang(text, lang) or i18n.alternate_lang(lang)
        context.user_data[LANG_KEY] = target
        await db.set_user_language(update.effective_user.id, target)
        lang = target
        await update.message.reply_text(
            i18n.t("language_set", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    state = context.user_data.get(STATE_KEY)
    if state == "waiting_game_id":
        await _handle_game_id(update, context, lang)
        return

    digits = re.sub(r"\D", "", text)
    if state == "waiting_tx_digits" or (
        TX_SUFFIX_RE.match(digits)
        and await _resolve_open_order(context, row["id"])
    ):
        context.user_data[STATE_KEY] = "waiting_tx_digits"
        await _handle_tx_digits(update, context, lang)
        return

    await update.message.reply_text(
        i18n.t("use_menu", lang),
        reply_markup=main_menu_keyboard(lang),
    )


async def _show_plans(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    plans = load_package_lists()
    if not plans:
        await update.message.reply_text(
            i18n.t("no_plans", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return
    await update.message.reply_text(
        i18n.t("choose_plan", lang),
        reply_markup=plans_inline(plans, lang),
    )


async def callback_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data or not query.from_user:
        return
    await query.answer()
    data = query.data

    row = await db.upsert_user(
        query.from_user.id,
        username=query.from_user.username,
        first_name=query.from_user.first_name,
    )
    lang = _lang(context, row)

    if data.startswith("lang:"):
        new_lang = i18n.normalize_lang(data.split(":", 1)[1])
        context.user_data[LANG_KEY] = new_lang
        await db.set_user_language(query.from_user.id, new_lang)
        lang = new_lang
        if query.message:
            await query.message.reply_text(
                i18n.t("language_set", lang),
                reply_markup=main_menu_keyboard(lang),
            )
        return

    if data == "menu:back":
        _clear_flow(context)
        if query.message:
            await query.message.reply_text(
                i18n.t("main_menu", lang),
                reply_markup=main_menu_keyboard(lang),
            )
        return

    if data.startswith("plan:"):
        plan_id = int(data.split(":", 1)[1])
        open_order = await db.get_open_order_for_user(row["id"])
        if open_order:
            if open_order["status"] == "awaiting_payment":
                context.user_data[ORDER_KEY] = open_order["id"]
                context.user_data[STATE_KEY] = "waiting_tx_digits"
                key = "order_already_open"
            elif open_order["status"] == "manual_review":
                key = "payment_under_review"
            else:
                key = "order_already_open"
            await _safe_edit_message_text(query, i18n.t(key, lang))
            return
        plan = _plan_by_id(plan_id)
        if not plan:
            await _safe_edit_message_text(query, i18n.t("plan_not_found", lang))
            return
        context.user_data[PLAN_KEY] = plan
        context.user_data[STATE_KEY] = "waiting_game_id"
        await _safe_edit_message_text(query, i18n.t("game_id_prompt", lang))
        return

    if data == "order:cancel":
        key = await _cancel_open_awaiting_order(context, row["id"])
        markup = (
            failure_contact_markup(lang)
            if key == "cannot_cancel_review"
            else main_menu_keyboard(lang)
        )
        if query.message:
            await query.message.reply_text(i18n.t(key, lang), reply_markup=markup)
        return

    if data == "order:confirm":
        await _confirm_order(update, context, lang)
        return


async def _handle_game_id(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    if not update.message:
        return
    raw = (update.message.text or "").strip()
    m = GAME_ID_RE.match(raw)
    if not m:
        await update.message.reply_text(
            i18n.t("game_id_invalid", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    game_id, server_id = m.group(1), m.group(2)
    plan = context.user_data.get(PLAN_KEY)
    if not plan:
        _clear_flow(context)
        await update.message.reply_text(i18n.t("session_expired", lang))
        return

    await update.message.reply_text(i18n.t("checking_account", lang))
    result = SmileOneClient().check_mlbb_account(game_id, server_id)
    if isinstance(result, str):
        await update.message.reply_text(
            f"❌ {result}",
            reply_markup=main_menu_keyboard(lang),
        )
        _clear_flow(context)
        return

    assert isinstance(result, MlbbAccount)
    user = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    lang = _lang(context, user)
    order = await db.create_order(
        user["id"],
        package_id=int(plan.get("id", 0)),
        package_name=str(plan.get("package_name", "")),
        amount_ks=_price_ks(plan.get("price", "")),
        smile_goods_id=str(plan.get("smile_goods_id", "")),
        game_id=game_id,
        server_id=server_id,
        nickname=result.nickname,
        region=result.region,
    )
    context.user_data[ORDER_KEY] = order["id"]
    context.user_data[STATE_KEY] = "waiting_confirm"

    region_label = result.region
    if result.country:
        region_label = f"{result.country} ({result.region})"

    await update.message.reply_text(
        f"ID + Server : {game_id}({server_id})\n"
        f"  {result.nickname.upper()}\n"
        f"  {region_label} Region\n\n"
        f"{i18n.t('confirm_account', lang)}",
        reply_markup=confirm_keyboard(lang),
    )


async def _confirm_order(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    query = update.callback_query
    if not query or not query.message or not query.from_user:
        return

    user_row = await db.upsert_user(
        query.from_user.id,
        username=query.from_user.username,
        first_name=query.from_user.first_name,
    )
    order_id = await _resolve_open_order(context, user_row["id"])
    if not order_id:
        _clear_flow(context)
        await query.message.reply_text(i18n.t("session_expired", lang))
        return

    order = await db.get_order(order_id)
    if not order:
        _clear_flow(context)
        await query.message.reply_text(i18n.t("order_not_found", lang))
        return

    context.user_data[STATE_KEY] = "waiting_tx_digits"
    await query.edit_message_reply_markup(reply_markup=None)

    phone = config.KBZ_PAY_PHONE or ""
    await query.message.reply_text(
        _kbz_pay_instructions(order["amount_ks"], lang),
        reply_markup=kbz_copy_phone_keyboard(phone, lang),
    )

    sample = config.KBZ_SAMPLE_TX_IMAGE
    caption = i18n.t("tx_example_caption", lang, example=config.KBZ_TX_EXAMPLE)
    if sample.is_file():
        await query.message.reply_photo(
            photo=str(sample),
            caption=caption,
        )
    else:
        await query.message.reply_text(caption)

    await query.message.reply_text(i18n.t("tx_digits_prompt", lang))


async def _handle_tx_digits(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    if not update.message or not update.effective_user:
        return
    digits = re.sub(r"\D", "", (update.message.text or "").strip())
    if not TX_SUFFIX_RE.match(digits):
        await update.message.reply_text(i18n.t("tx_digits_invalid", lang))
        return

    user_row = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    order_id = await _resolve_open_order(context, user_row["id"])
    if not order_id:
        _clear_flow(context)
        await update.message.reply_text(i18n.t("session_expired", lang))
        return

    order = await db.get_order(order_id)
    if not order:
        _clear_flow(context)
        await update.message.reply_text(i18n.t("order_not_found", lang))
        return

    if order["status"] == "manual_review":
        await update.message.reply_text(
            i18n.t("payment_under_review", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        _clear_flow(context)
        return

    if order["status"] != "awaiting_payment":
        await update.message.reply_text(i18n.t("session_expired", lang))
        _clear_flow(context)
        return

    await update.message.reply_text(i18n.t("checking_tx", lang))
    result = await verify_last5_digits(digits, order["amount_ks"])

    lang = _lang(context, user_row)
    user_row["telegram_id"] = update.effective_user.id

    # KBZ session down / API error → keep order open for Accept/Decline
    if result.status in ("token_invalid", "error"):
        note = f"Last5: {digits}. {result.message}"
        await db.update_order(
            order["id"],
            verify_status=result.status,
            verify_message=note,
            status="manual_review",
        )
        order["status"] = "manual_review"
        await post_order_proof(
            update.get_bot(),
            order=order,
            user=user_row,
            status="manual_review",
            note=note,
        )
        await update.message.reply_text(
            i18n.t("payment_under_review", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        _clear_flow(context)
        return

    if result.status != "ok" or not result.trans_id:
        await db.update_order(
            order["id"],
            verify_status=result.status,
            verify_message=result.message,
            status="payment_failed",
        )
        await post_order_proof(
            update.get_bot(),
            order=order,
            user=user_row,
            status="payment_failed",
            note=result.message,
        )
        await update.message.reply_text(
            i18n.t("payment_failed", lang),
            reply_markup=failure_contact_markup(lang),
        )
        _clear_flow(context)
        return

    claimed = await db.claim_kbz_trans(result.trans_id, order["id"])
    if not claimed:
        await update.message.reply_text(
            i18n.t("tx_already_used", lang),
            reply_markup=failure_contact_markup(lang),
        )
        _clear_flow(context)
        return

    await db.update_order(
        order["id"],
        kbz_trans_id=result.trans_id,
        verify_status="ok",
        verify_message=result.message,
        status="processing",
    )
    order["kbz_trans_id"] = result.trans_id

    await post_order_proof(
        update.get_bot(),
        order=order,
        user=user_row,
        status="auto_approved",
    )

    await update.message.reply_text(i18n.t("payment_verified", lang))
    await update.message.reply_text(i18n.t("topup_processing", lang))

    try:
        msg = await asyncio.to_thread(
            place_mlbb_order,
            smile_goods_id=order["smile_goods_id"],
            game_id=order["game_id"],
            server_id=order["server_id"],
            package_name=order["package_name"],
        )
        await db.update_order(order["id"], status="completed")
        await post_order_proof(
            update.get_bot(),
            order=order,
            user=user_row,
            status="completed",
            note=msg,
        )
        await update.message.reply_text(
            i18n.t("payment_ok", lang),
            reply_markup=main_menu_keyboard(lang),
        )
    except Exception as e:
        logger.exception("Top-up failed")
        await db.update_order(order["id"], status="topup_failed", verify_message=str(e))
        await post_order_proof(
            update.get_bot(),
            order=order,
            user=user_row,
            status="topup_failed",
            note=str(e),
        )
        await update.message.reply_text(
            i18n.t("topup_failed", lang),
            reply_markup=failure_contact_markup(lang),
        )

    _clear_flow(context)


async def _show_history(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    if not update.message or not update.effective_user:
        return
    user = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    orders = await db.list_user_orders(user["id"], limit=10)
    if not orders:
        await update.message.reply_text(
            i18n.t("no_orders", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return
    lines = [i18n.t("history_header", lang)]
    for o in orders:
        lines.append(
            f"#{o['id']} {o['package_name']} — {i18n.format_amount(o['amount_ks'], lang)}\n"
            f"   {o['game_id']}({o['server_id']}) · {o['status']}"
        )
    await update.message.reply_text(
        "\n".join(lines),
        reply_markup=main_menu_keyboard(lang),
    )
