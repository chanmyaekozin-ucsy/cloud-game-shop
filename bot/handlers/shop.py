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
    payment_check_keyboard,
    payment_method_keyboard,
    plans_inline,
    save_game_id_keyboard,
    saved_game_accounts_keyboard,
)
from providers.smileone.client import SmileOneClient
from providers.smileone.mlbb import MlbbAccount
from providers.smileone.packages import load_package_lists
from services.kbz_payment import verify_last5_digits
from services.payment_proofs import post_order_proof
from services import dominate_gateway, shop_payment_catalog
from services.topup import place_mlbb_order
from services.wave_payment import verify_last5_digits as verify_wave_last5_digits

logger = logging.getLogger("cloud_gameshop.shop")

GAME_ID_RE = re.compile(r"^(\d+)\((\d+)\)\s*$")
TX_SUFFIX_RE = re.compile(r"^\d{5}$")

STATE_KEY = "shop_state"
ORDER_KEY = "pending_order_id"
PLAN_KEY = "pending_plan"
LANG_KEY = "language"
PAY_METHOD_KEY = "pay_method"
GATEWAY_DEPOSIT_KEY = "gateway_deposit_id"


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
    context.user_data.pop(PAY_METHOD_KEY, None)
    context.user_data.pop(GATEWAY_DEPOSIT_KEY, None)


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


def _kbz_pay_instructions(amount_ks: int, lang: str, *, name: str, phone: str) -> str:
    return i18n.t(
        "kbz_pay",
        lang,
        amount=i18n.format_amount(amount_ks, lang),
        name=name or "Cloud Game Shop",
        phone=phone or "—",
    )


def _wave_pay_instructions(amount_ks: int, lang: str, *, name: str, phone: str) -> str:
    return i18n.t(
        "wave_pay",
        lang,
        amount=i18n.format_amount(amount_ks, lang),
        name=name or "Cloud Game Shop",
        phone=phone or "—",
    )


async def _reply_pay_unavailable(message, lang: str) -> None:
    markup = admin_contact_keyboard(lang) or main_menu_keyboard(lang)
    await message.reply_text(i18n.t("pay_unavailable", lang), reply_markup=markup)


async def _offer_pay_method_picker(message, context, lang: str) -> bool:
    """Show payment methods from Payment Manager catalog. False if unavailable."""
    methods = shop_payment_catalog.enabled_methods()
    if not methods:
        context.user_data.pop(STATE_KEY, None)
        await _reply_pay_unavailable(message, lang)
        return False
    context.user_data[STATE_KEY] = "waiting_pay_method"
    await message.reply_text(
        i18n.t("choose_pay_method", lang),
        reply_markup=payment_method_keyboard(lang, methods=methods),
    )
    return True


async def _send_pay_instructions(
    message,
    order: dict,
    lang: str,
    *,
    method: str,
    account: dict | None = None,
    deposit: dict | None = None,
) -> None:
    acct = account or shop_payment_catalog.account_for_method(method)
    name = (acct or {}).get("account_name") or ""
    phone = (acct or {}).get("account_number") or ""
    if deposit:
        payee = deposit.get("payee") or {}
        name = str(payee.get("display_name") or name)
        phone = str(payee.get("msisdn") or phone)
    if method == "WavePay":
        if not name:
            name = config.WAVE_PAY_DISPLAY_NAME or config.WAVE_MERCHANT_NAME or ""
        if not phone:
            phone = config.WAVE_PAY_PHONE or config.WAVE_MERCHANT_PHONE or ""
        text = _wave_pay_instructions(order["amount_ks"], lang, name=name, phone=phone)
        sample = config.WAVE_SAMPLE_TX_IMAGE
        example = config.WAVE_TX_EXAMPLE
    else:
        if not name:
            name = config.KBZ_PAY_DISPLAY_NAME or config.KBZ_MERCHANT_NAME or ""
        if not phone:
            phone = config.KBZ_PAY_PHONE or config.KBZ_MERCHANT_PHONE or ""
        text = _kbz_pay_instructions(order["amount_ks"], lang, name=name, phone=phone)
        sample = config.KBZ_SAMPLE_TX_IMAGE
        example = config.KBZ_TX_EXAMPLE

    await message.reply_text(
        text,
        reply_markup=kbz_copy_phone_keyboard(phone, lang),
    )
    if deposit:
        prompt = (
            "After you pay the exact amount, tap Check payment."
            if lang == "en"
            else "အတိအကျ ပမာဏ ပေးပြီးပါက Check payment ကို နှိပ်ပါ။"
        )
        await message.reply_text(
            prompt,
            reply_markup=payment_check_keyboard(int(order["id"]), lang),
        )
        return

    caption = i18n.t("tx_example_caption", lang, example=example)
    if sample.is_file():
        await message.reply_photo(photo=str(sample), caption=caption)
    else:
        await message.reply_text(caption)
    await message.reply_text(i18n.t("tx_digits_prompt", lang))

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
    if state == "waiting_saved_account":
        # Allow typing a new GameID(Server) instead of tapping New
        raw = (update.message.text or "").strip()
        if GAME_ID_RE.match(raw):
            await _handle_game_id(update, context, lang)
            return
        saved = await db.list_saved_game_accounts(row["id"])
        await update.message.reply_text(
            i18n.t("choose_saved_game_id", lang),
            reply_markup=saved_game_accounts_keyboard(saved, lang),
        )
        return

    digits = re.sub(r"\D", "", text)
    # Gateway flow: digits are not used — Check payment button only
    if state == "waiting_gateway_check":
        order = await _resolve_open_order(context, row["id"])
        prompt = (
            "No need to type digits. Pay the exact amount, then tap Check payment."
            if lang == "en"
            else "နံပါတ်ရိုက်စရာ မလိုပါ။ အတိအကျ ပမာဏ ပေးပြီး Check payment ကို နှိပ်ပါ။"
        )
        await update.message.reply_text(
            prompt,
            reply_markup=payment_check_keyboard(order["id"], lang) if order else None,
        )
        return
    if state == "waiting_tx_digits" or (
        state not in ("waiting_pay_method", "waiting_game_id", "waiting_confirm", "waiting_gateway_check")
        and TX_SUFFIX_RE.match(digits)
        and await _resolve_open_order(context, row["id"])
    ):
        if not context.user_data.get(PAY_METHOD_KEY):
            await _offer_pay_method_picker(update.message, context, lang)
            return
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
                await _safe_edit_message_text(
                    query,
                    i18n.t("order_already_open", lang),
                )
                await _offer_pay_method_picker(query.message, context, lang)
                return
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
        await _offer_game_id_step(
            query.message, context, row["id"], lang, edit_query=query
        )
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

    if data in ("pay:kbz", "pay:wave"):
        await _choose_pay_method(update, context, lang, data)
        return

    if data.startswith("pay:check:"):
        await _handle_gateway_paycheck(update, context, lang, data)
        return

    if data.startswith("saveacc:"):
        await _handle_save_account_callback(update, context, lang, data)
        return

    if data.startswith("savedacc:"):
        await _handle_saved_account_pick(update, context, lang, data)
        return


async def _ask_save_game_id(message, order: dict, lang: str) -> None:
    """Offer to remember game ID + server after a successful top-up."""
    nickname = (order.get("nickname") or "").strip()
    if not nickname:
        nickname = f"{order.get('game_id')}({order.get('server_id')})"
    await message.reply_text(
        i18n.t("save_game_id_ask", lang, nickname=nickname),
        reply_markup=save_game_id_keyboard(int(order["id"]), lang),
    )


async def _offer_game_id_step(
    message,
    context: ContextTypes.DEFAULT_TYPE,
    user_db_id: int,
    lang: str,
    *,
    edit_query=None,
) -> None:
    """After plan select: saved accounts picker, or prompt for new Game ID."""
    saved = await db.list_saved_game_accounts(user_db_id)
    if saved:
        context.user_data[STATE_KEY] = "waiting_saved_account"
        text = i18n.t("choose_saved_game_id", lang)
        markup = saved_game_accounts_keyboard(saved, lang)
        if edit_query is not None:
            await _safe_edit_message_text(edit_query, text, reply_markup=markup)
        else:
            await message.reply_text(text, reply_markup=markup)
        return
    context.user_data[STATE_KEY] = "waiting_game_id"
    text = i18n.t("game_id_prompt", lang)
    if edit_query is not None:
        await _safe_edit_message_text(edit_query, text)
    else:
        await message.reply_text(text)


async def _begin_order_for_game(
    message,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    user,
    lang: str,
    plan: dict,
    game_id: str,
    server_id: str,
) -> None:
    await message.reply_text(i18n.t("checking_account", lang))
    result = SmileOneClient().check_mlbb_account(game_id, server_id)
    if isinstance(result, str):
        await message.reply_text(
            f"❌ {result}",
            reply_markup=main_menu_keyboard(lang),
        )
        _clear_flow(context)
        return

    assert isinstance(result, MlbbAccount)
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
        smile_coin=str(plan.get("smile_coin") or "").strip(),
    )
    context.user_data[ORDER_KEY] = order["id"]
    context.user_data[STATE_KEY] = "waiting_confirm"

    region_label = result.region
    if result.country:
        region_label = f"{result.country} ({result.region})"

    await message.reply_text(
        f"ID + Server : {game_id}({server_id})\n"
        f"  {result.nickname.upper()}\n"
        f"  {region_label} Region\n\n"
        f"{i18n.t('confirm_account', lang)}",
        reply_markup=confirm_keyboard(lang),
    )


async def _handle_game_id(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
) -> None:
    if not update.message or not update.effective_user:
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

    user = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    lang = _lang(context, user)
    await _begin_order_for_game(
        update.message,
        context,
        user=user,
        lang=lang,
        plan=plan,
        game_id=game_id,
        server_id=server_id,
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

    await query.edit_message_reply_markup(reply_markup=None)
    await _offer_pay_method_picker(query.message, context, lang)


async def _choose_pay_method(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
    data: str,
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
    if not order or order["status"] != "awaiting_payment":
        _clear_flow(context)
        await query.message.reply_text(i18n.t("order_not_found", lang))
        return

    method = "WavePay" if data == "pay:wave" else "KBZPay"
    account = shop_payment_catalog.account_for_method(method)
    if not account:
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except BadRequest:
            pass
        await _reply_pay_unavailable(query.message, lang)
        return

    context.user_data[PAY_METHOD_KEY] = method
    deposit = None
    if dominate_gateway.gateway_configured():
        try:
            deposit = await asyncio.to_thread(
                dominate_gateway.create_deposit,
                account_id=str(account.get("id") or ""),
                amount_ks=int(order["amount_ks"]),
                external_ref=f"cgs-order-{order_id}",
            )
            context.user_data[GATEWAY_DEPOSIT_KEY] = deposit.get("id")
            context.user_data[STATE_KEY] = "waiting_gateway_check"
        except Exception:
            logger.exception("Gateway create_deposit failed for order %s", order_id)
            await _reply_pay_unavailable(query.message, lang)
            return
    else:
        context.user_data[STATE_KEY] = "waiting_tx_digits"
    try:
        await query.edit_message_reply_markup(reply_markup=None)
    except BadRequest:
        pass
    await _send_pay_instructions(
        query.message,
        order,
        lang,
        method=method,
        account=account,
        deposit=deposit,
    )


async def _handle_gateway_paycheck(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
    data: str,
) -> None:
    query = update.callback_query
    if not query or not query.message or not query.from_user:
        return
    try:
        order_id = int(data.split(":")[-1])
    except ValueError:
        await query.answer()
        return

    deposit_id = context.user_data.get(GATEWAY_DEPOSIT_KEY)
    if not deposit_id:
        await query.answer("Payment session expired.", show_alert=True)
        return

    user_row = await db.upsert_user(
        query.from_user.id,
        username=query.from_user.username,
        first_name=query.from_user.first_name,
    )
    order = await db.get_order(order_id)
    if not order or order["user_id"] != user_row["id"]:
        await query.answer("Order not found.", show_alert=True)
        return
    if order["status"] != "awaiting_payment":
        await query.answer("Already processed.", show_alert=True)
        return

    await query.answer()
    await query.message.reply_text(i18n.t("checking_tx", lang))
    try:
        deposit = await asyncio.to_thread(dominate_gateway.get_deposit, str(deposit_id))
    except Exception:
        logger.exception("Gateway get_deposit failed for order %s", order_id)
        await query.message.reply_text(
            i18n.t("payment_under_review", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    status = str(deposit.get("status") or "")
    if status == "pending":
        await query.message.reply_text(
            "Payment not found yet. Pay the exact amount, then tap Check payment again."
            if lang == "en"
            else "ငွေမရသေးပါ။ အတိအကျ ပမာဏ ပေးပြီး Check payment ကို ထပ်နှိပ်ပါ။",
            reply_markup=payment_check_keyboard(order_id, lang),
        )
        return
    if status == "expired":
        await db.update_order(
            order_id,
            verify_status="expired",
            verify_message="Gateway deposit expired",
            status="payment_failed",
        )
        await query.message.reply_text(
            i18n.t("payment_failed", lang),
            reply_markup=failure_contact_markup(lang),
        )
        _clear_flow(context)
        return
    if status != "paid":
        await query.message.reply_text(
            i18n.t("payment_failed", lang),
            reply_markup=failure_contact_markup(lang),
        )
        _clear_flow(context)
        return

    tx_id = str(deposit.get("matched_order_id") or deposit.get("id") or "")
    claimed = await db.claim_kbz_trans(tx_id, order_id)
    if not claimed:
        await query.message.reply_text(
            i18n.t("tx_already_used", lang),
            reply_markup=failure_contact_markup(lang),
        )
        _clear_flow(context)
        return

    await db.update_order(
        order_id,
        kbz_trans_id=tx_id,
        verify_status="ok",
        verify_message=f"Gateway deposit {deposit_id}",
        status="processing",
    )
    order["kbz_trans_id"] = tx_id
    user_row["telegram_id"] = query.from_user.id
    await post_order_proof(
        update.get_bot(),
        order=order,
        user=user_row,
        status="auto_approved",
    )
    await query.message.reply_text(i18n.t("payment_verified", lang))
    await query.message.reply_text(i18n.t("topup_processing", lang))
    try:
        msg = await asyncio.to_thread(
            place_mlbb_order,
            smile_goods_id=order["smile_goods_id"],
            game_id=order["game_id"],
            server_id=order["server_id"],
            package_name=order["package_name"],
        )
        await db.update_order(order_id, status="completed")
        await post_order_proof(
            update.get_bot(),
            order=order,
            user=user_row,
            status="completed",
            note=msg,
        )
        await query.message.reply_text(
            i18n.t("payment_ok", lang),
            reply_markup=main_menu_keyboard(lang),
        )
    except Exception as exc:
        logger.exception("Topup failed after gateway pay for order %s", order_id)
        await db.update_order(order_id, status="manual_review", verify_message=str(exc)[:400])
        await query.message.reply_text(
            i18n.t("payment_under_review", lang),
            reply_markup=main_menu_keyboard(lang),
        )
    _clear_flow(context)


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
    method = context.user_data.get(PAY_METHOD_KEY) or "KBZPay"
    if method == "WavePay":
        result = await verify_wave_last5_digits(digits, order["amount_ks"])
    else:
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
        await _ask_save_game_id(update.message, order, lang)
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


async def _handle_save_account_callback(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
    data: str,
) -> None:
    query = update.callback_query
    if not query or not query.message or not query.from_user:
        return

    if data == "saveacc:no":
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except BadRequest:
            pass
        await query.message.reply_text(
            i18n.t("save_game_id_skipped", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    if not data.startswith("saveacc:yes:"):
        return
    try:
        order_id = int(data.rsplit(":", 1)[1])
    except ValueError:
        return

    user = await db.upsert_user(
        query.from_user.id,
        username=query.from_user.username,
        first_name=query.from_user.first_name,
    )
    order = await db.get_order(order_id)
    if not order or int(order["user_id"]) != int(user["id"]):
        await query.message.reply_text(
            i18n.t("order_not_found", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return
    if not order.get("game_id") or not order.get("server_id"):
        await query.message.reply_text(
            i18n.t("session_expired", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    await db.upsert_saved_game_account(
        user["id"],
        game_id=str(order["game_id"]),
        server_id=str(order["server_id"]),
        nickname=str(order.get("nickname") or ""),
        region=str(order.get("region") or ""),
    )
    try:
        await query.edit_message_reply_markup(reply_markup=None)
    except BadRequest:
        pass
    await query.message.reply_text(
        i18n.t("save_game_id_saved", lang),
        reply_markup=main_menu_keyboard(lang),
    )


async def _handle_saved_account_pick(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
    data: str,
) -> None:
    query = update.callback_query
    if not query or not query.message or not query.from_user:
        return

    plan = context.user_data.get(PLAN_KEY)
    if not plan:
        _clear_flow(context)
        await query.message.reply_text(
            i18n.t("session_expired", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    if data == "savedacc:new":
        context.user_data[STATE_KEY] = "waiting_game_id"
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except BadRequest:
            pass
        await query.message.reply_text(i18n.t("game_id_prompt", lang))
        return

    if not data.startswith("savedacc:"):
        return
    try:
        account_id = int(data.split(":", 1)[1])
    except ValueError:
        return

    user = await db.upsert_user(
        query.from_user.id,
        username=query.from_user.username,
        first_name=query.from_user.first_name,
    )
    saved = await db.get_saved_game_account(account_id, user["id"])
    if not saved:
        await query.message.reply_text(
            i18n.t("session_expired", lang),
            reply_markup=main_menu_keyboard(lang),
        )
        return

    try:
        await query.edit_message_reply_markup(reply_markup=None)
    except BadRequest:
        pass

    await _begin_order_for_game(
        query.message,
        context,
        user=user,
        lang=lang,
        plan=plan,
        game_id=str(saved["game_id"]),
        server_id=str(saved["server_id"]),
    )


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
