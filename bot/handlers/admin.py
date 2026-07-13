"""Admin panel — users, package CSV workflow, broadcast, KBZ session."""

from __future__ import annotations

import asyncio
import json
import logging
from io import BytesIO
from pathlib import Path

from telegram import InputFile, Update
from telegram.ext import ContextTypes

import database as db
from bot import config
from bot import i18n
from bot.keyboards import (
    admin_broadcast_confirm_inline,
    admin_menu_keyboard,
    admin_packages_inline,
    main_menu_keyboard,
)
from payments.kbz.session_store import (
    HISTORY_LOCKED_MSG,
    probe_session,
    unlock_history_with_pin,
)
from providers.smileone.auth import SmileAuthError
from providers.smileone.client import SmileOneClient
from providers.smileone.packages import load_package_lists, save_package_lists
from services.package_csv import build_auto_rows, csv_to_package_records, rows_to_csv_bytes

logger = logging.getLogger("cloud_gameshop.admin")

ADMIN_MODE_KEY = "admin_mode"
ADMIN_STATE_KEY = "admin_state"
BROADCAST_TEXT_KEY = "admin_broadcast_text"

BTN_USERS = "👤 Users"
BTN_PACKAGES = "📦 Packages"
BTN_KBZ_SESSION = "🔑 KBZ Session"
BTN_NOTIFY = "📢 Notify"
BTN_EXIT = "🚪 Exit Admin"

_MAX_KBZ_SESSION_BYTES = 512 * 1024


def is_admin(user_id: int) -> bool:
    return user_id in config.ADMIN_USER_IDS


def _input_text(update: Update) -> str:
    return (update.message.text or "").strip().splitlines()[0].strip()


def _clear_admin(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop(ADMIN_MODE_KEY, None)
    context.user_data.pop(ADMIN_STATE_KEY, None)
    context.user_data.pop(BROADCAST_TEXT_KEY, None)


def _set_admin_state(context: ContextTypes.DEFAULT_TYPE, state: str | None) -> None:
    if state:
        context.user_data[ADMIN_STATE_KEY] = state
    else:
        context.user_data.pop(ADMIN_STATE_KEY, None)


async def cmd_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.effective_user:
        return
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("Not authorized.")
        return

    context.user_data[ADMIN_MODE_KEY] = True
    _set_admin_state(context, None)
    await update.message.reply_text(
        "🔧 Admin mode\n\n"
        "• Users — list bot users\n"
        "• Packages — auto CSV / import / view\n"
        "• KBZ Session — upload kbz_session.json\n"
        "• Notify — broadcast message to all users",
        reply_markup=admin_menu_keyboard(),
    )


async def _exit_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    _clear_admin(context)
    row = await db.upsert_user(
        update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
    )
    lang = i18n.normalize_lang(row.get("language"))
    await update.message.reply_text(
        "Left admin mode.",
        reply_markup=main_menu_keyboard(lang),
    )


async def _show_users(update: Update) -> None:
    if not update.message:
        return
    total = await db.count_users()
    users = await db.list_users(limit=25)
    lines = [f"👤 Users ({total} total)", ""]
    if not users:
        lines.append("No users yet.")
    else:
        lines.append("Latest 25:")
        for u in users:
            username = f"@{u['username']}" if u.get("username") else "—"
            lines.append(
                f"• {u.get('first_name') or '—'} ({username})\n"
                f"  id {u['telegram_id']} · {u.get('language') or 'my'} · "
                f"{u.get('order_count', 0)} orders"
            )
    await update.message.reply_text("\n".join(lines), reply_markup=admin_menu_keyboard())


async def _show_packages_menu(update: Update) -> None:
    if not update.message:
        return
    count = len(load_package_lists())
    await update.message.reply_text(
        f"📦 Package list ({count} active)\n\n"
        "Auto CSV: fetch Smile.one packages → apply multiplier → export CSV.\n"
        "Edit the CSV, then send it back here as a file.",
        reply_markup=admin_packages_inline(),
    )


async def _view_packages(update: Update) -> None:
    if not update.message:
        return
    plans = load_package_lists()
    if not plans:
        await update.message.reply_text(
            "No packages loaded.",
            reply_markup=admin_menu_keyboard(),
        )
        return
    lines = ["📋 Current packages", ""]
    for p in plans:
        lines.append(
            f"#{p.get('id')} {p.get('package_name')}\n"
            f"   {p.get('price')} · coin {p.get('smile_coin')} · "
            f"goods {p.get('smile_goods_id')}"
        )
    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:3990] + "\n…"
    await update.message.reply_text(text, reply_markup=admin_menu_keyboard())


async def _handle_multiplier(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
) -> None:
    if not update.message:
        return
    raw = text.replace(",", "").strip()
    try:
        multiplier = float(raw)
    except ValueError:
        await update.message.reply_text("Invalid number. Send e.g. 90")
        return
    if multiplier <= 0:
        await update.message.reply_text("Multiplier must be positive.")
        return

    await update.message.reply_text("Fetching Smile.one packages…")
    try:
        packages = await asyncio.to_thread(SmileOneClient().get_mlbb_packages)
    except SmileAuthError as exc:
        _set_admin_state(context, None)
        await update.message.reply_text(f"Smile.one error: {exc}")
        return
    except Exception as exc:
        logger.exception("Failed to fetch MLBB packages")
        _set_admin_state(context, None)
        await update.message.reply_text(f"Failed to fetch packages: {exc}")
        return

    if not packages:
        _set_admin_state(context, None)
        await update.message.reply_text("No packages returned from Smile.one.")
        return

    rows = build_auto_rows(packages, multiplier)
    csv_bytes = rows_to_csv_bytes(rows)
    filename = f"packages_auto_{int(multiplier)}.csv"
    _set_admin_state(context, "waiting_csv_import")

    await update.message.reply_document(
        document=InputFile(BytesIO(csv_bytes), filename=filename),
        caption=(
            f"✅ {len(rows)} packages · multiplier {multiplier:g}\n\n"
            "Edit this CSV (package names / prices), then send the file back here."
        ),
    )


async def _import_csv_bytes(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    content: bytes,
    *,
    filename: str = "packages.csv",
) -> None:
    if not update.message:
        return

    records, warnings = csv_to_package_records(content)
    if not records:
        await update.message.reply_text(
            "Import failed:\n" + "\n".join(warnings[:10]),
            reply_markup=admin_menu_keyboard(),
        )
        return

    path = save_package_lists(records)
    _set_admin_state(context, None)

    lines = [
        f"✅ Package list updated — {len(records)} packages",
        f"Saved to {path.name}",
        "",
    ]
    for rec in records[:8]:
        price = str(rec.get("price", "")).replace(" MMK", "")
        lines.append(f"• #{rec['id']} {rec['package_name']} — {price} MMK")
    if len(records) > 8:
        lines.append(f"… and {len(records) - 8} more")

    if warnings:
        lines.extend(["", "Warnings:"])
        lines.extend(f"• {w}" for w in warnings[:5])

    await update.message.reply_text(
        "\n".join(lines),
        reply_markup=admin_menu_keyboard(),
    )


async def _ask_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    _set_admin_state(context, "waiting_broadcast")
    context.user_data.pop(BROADCAST_TEXT_KEY, None)
    await update.message.reply_text(
        "Send the notification text to broadcast to all bot users.",
        reply_markup=admin_menu_keyboard(),
    )


async def _ask_kbz_session(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    path = Path(config.KBZ_SESSION_PATH)
    if path.is_file():
        ok, probe_err = await asyncio.to_thread(probe_session, path)
        if ok and probe_err.startswith("HISTORY_LOCKED"):
            await update.message.reply_text(
                "Current session balance is OK, but history is locked.\n"
                "Enter PIN to unlock, or send a new kbz_session.json file.",
                reply_markup=admin_menu_keyboard(),
            )
            await _ask_kbz_history_pin(update.effective_chat.id, context)
            return

    _set_admin_state(context, "waiting_kbz_session")
    await update.message.reply_text(
        "Send kbz_session.json as a document.\n\n"
        f"It will be saved to {path.name} and your upload message will be deleted.\n"
        "Required fields: token, deviceID, initiatorMSISDN, imei.",
        reply_markup=admin_menu_keyboard(),
    )


def _validate_kbz_session_payload(data: object) -> tuple[dict | None, str | None]:
    if not isinstance(data, dict):
        return None, "JSON root must be an object."
    token = str(data.get("token") or "").strip()
    device_id = str(data.get("deviceID") or data.get("device_id") or "").strip()
    msisdn = str(data.get("initiatorMSISDN") or data.get("msisdn") or "").strip()
    imei = str(data.get("imei") or "").strip()
    if not token:
        return None, "Missing token."
    if not device_id:
        return None, "Missing deviceID."
    if not msisdn:
        return None, "Missing initiatorMSISDN."
    if not imei:
        return None, "Missing imei."
    return data, None


async def _delete_upload_message(update: Update) -> None:
    if not update.message:
        return
    try:
        await update.message.delete()
    except Exception:
        logger.warning("Could not delete KBZ session upload message", exc_info=True)


async def _refresh_proofs_monitor(bot) -> None:
    """Force an immediate Smile + KBZ balance post to the proofs group."""
    try:
        from services.balance_monitor import clear_kbz_balance_cache, run_monitor_tick

        clear_kbz_balance_cache()
        await run_monitor_tick(bot)
    except Exception:
        logger.exception("Failed to refresh proofs-group balance monitor")


async def _ask_kbz_history_pin(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    _set_admin_state(context, "waiting_kbz_pin")
    await context.bot.send_message(
        chat_id=chat_id,
        text=(
            "🔐 KBZ history is locked (needVerifyPin).\n\n"
            "Send your 6-digit KBZPay PIN.\n"
            "If unlock works, your PIN message will be deleted."
        ),
        reply_markup=admin_menu_keyboard(),
    )


async def _handle_kbz_pin(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
) -> None:
    if not update.message or not update.effective_chat:
        return
    pin = "".join(ch for ch in text if ch.isdigit())
    if len(pin) != 6:
        await update.message.reply_text("Send exactly 6 digits (KBZPay PIN).")
        return

    path = Path(config.KBZ_SESSION_PATH)
    ok, err, count = await asyncio.to_thread(unlock_history_with_pin, path, pin)
    if not ok:
        await update.message.reply_text(
            f"PIN unlock failed: {err}\n\nSend the 6-digit PIN again, or /admin to cancel.",
            reply_markup=admin_menu_keyboard(),
        )
        return

    await _delete_upload_message(update)
    _set_admin_state(context, None)
    await _refresh_proofs_monitor(update.get_bot())
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=(
            f"✅ KBZ history unlocked\n"
            f"Recent records visible: {count}\n"
            "PIN message deleted.\n"
            "Payment group balance updated."
        ),
        reply_markup=admin_menu_keyboard(),
    )


async def _import_kbz_session_bytes(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    content: bytes,
) -> None:
    if not update.message:
        return

    if len(content) > _MAX_KBZ_SESSION_BYTES:
        await update.message.reply_text(
            f"File too large (max {_MAX_KBZ_SESSION_BYTES // 1024} KB).",
            reply_markup=admin_menu_keyboard(),
        )
        return

    try:
        data = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        await update.message.reply_text(
            f"Invalid JSON: {exc}",
            reply_markup=admin_menu_keyboard(),
        )
        return

    payload, err = _validate_kbz_session_payload(data)
    if err or payload is None:
        await update.message.reply_text(
            f"Invalid session file: {err}",
            reply_markup=admin_menu_keyboard(),
        )
        return

    path = Path(config.KBZ_SESSION_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)

    try:
        from services.balance_monitor import clear_kbz_balance_cache

        clear_kbz_balance_cache()
    except Exception:
        logger.debug("Could not clear KBZ monitor cache", exc_info=True)

    ok, probe_err = await asyncio.to_thread(probe_session, path)
    await _delete_upload_message(update)

    msisdn = str(payload.get("initiatorMSISDN") or payload.get("msisdn") or "—")
    device_id = str(payload.get("deviceID") or payload.get("device_id") or "—")
    token = str(payload.get("token") or "")
    token_hint = f"{token[:8]}…{token[-8:]}" if len(token) > 20 else "…"
    chat = update.effective_chat
    if not chat:
        return

    history_locked = ok and probe_err.startswith("HISTORY_LOCKED")

    if ok and not probe_err:
        _set_admin_state(context, None)
        await _refresh_proofs_monitor(update.get_bot())
        text = (
            "✅ KBZ session updated\n"
            f"MSISDN: {msisdn}\n"
            f"deviceID: {device_id}\n"
            f"token: {token_hint}\n"
            "Balance + history probe: OK\n"
            "Upload message deleted.\n"
            "Payment group balance updated.\n\n"
            "Keep KBZPay closed on the phone or this session will get AS403."
        )
        await context.bot.send_message(
            chat_id=chat.id,
            text=text,
            reply_markup=admin_menu_keyboard(),
        )
        return

    if history_locked:
        await context.bot.send_message(
            chat_id=chat.id,
            text=(
                "⚠️ KBZ session saved (balance OK)\n"
                f"MSISDN: {msisdn}\n"
                f"deviceID: {device_id}\n"
                f"token: {token_hint}\n"
                "Upload message deleted.\n\n"
                f"{HISTORY_LOCKED_MSG}"
            ),
            reply_markup=admin_menu_keyboard(),
        )
        await _ask_kbz_history_pin(chat.id, context)
        return

    if ok:
        _set_admin_state(context, None)
        await _refresh_proofs_monitor(update.get_bot())
        text = (
            "⚠️ KBZ session saved (balance OK)\n"
            f"MSISDN: {msisdn}\n"
            f"deviceID: {device_id}\n"
            f"token: {token_hint}\n"
            f"{probe_err}\n"
            "Upload message deleted.\n"
            "Payment group balance updated.\n\n"
            "Keep KBZPay closed on the phone."
        )
        logger.warning("KBZ session saved with history warning: %s", probe_err)
    else:
        _set_admin_state(context, None)
        await _refresh_proofs_monitor(update.get_bot())
        text = (
            "⚠️ KBZ session saved, but probe failed\n"
            f"MSISDN: {msisdn}\n"
            f"deviceID: {device_id}\n"
            f"token: {token_hint}\n"
            f"Error: {probe_err}\n"
            "Upload message deleted.\n"
            "Payment group balance updated."
        )
        logger.warning("KBZ session saved but probe failed: %s", probe_err)

    await context.bot.send_message(
        chat_id=chat.id,
        text=text,
        reply_markup=admin_menu_keyboard(),
    )


async def _preview_broadcast(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
) -> None:
    if not update.message:
        return
    context.user_data[BROADCAST_TEXT_KEY] = text
    _set_admin_state(context, "confirm_broadcast")
    total = await db.count_users()
    preview = text if len(text) <= 500 else text[:500] + "…"
    await update.message.reply_text(
        f"Broadcast preview ({total} users):\n\n{preview}",
        reply_markup=admin_broadcast_confirm_inline(),
    )


async def _send_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.message:
        return
    text = context.user_data.get(BROADCAST_TEXT_KEY)
    if not text:
        await query.edit_message_text("Broadcast cancelled — no message stored.")
        _set_admin_state(context, None)
        return

    telegram_ids = await db.list_user_telegram_ids()
    sent = 0
    failed = 0
    bot = update.get_bot()
    for tid in telegram_ids:
        try:
            await bot.send_message(chat_id=tid, text=text)
            sent += 1
        except Exception:
            failed += 1
            logger.debug("Broadcast failed for %s", tid, exc_info=True)
        await asyncio.sleep(0.05)

    _set_admin_state(context, None)
    context.user_data.pop(BROADCAST_TEXT_KEY, None)
    await query.edit_message_text(
        f"✅ Broadcast done\nSent: {sent}\nFailed: {failed}"
    )
    await query.message.reply_text("Admin menu:", reply_markup=admin_menu_keyboard())


async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data or not query.from_user:
        return
    await query.answer()

    if not is_admin(query.from_user.id):
        if query.message:
            await query.message.reply_text("Not authorized.")
        return

    data = query.data

    if data == "admin:back":
        _set_admin_state(context, None)
        if query.message:
            await query.message.reply_text(
                "Admin menu:",
                reply_markup=admin_menu_keyboard(),
            )
        return

    if data == "admin:pkg:auto":
        context.user_data[ADMIN_MODE_KEY] = True
        await _fix_ask_multiplier_from_callback(update, context)
        return

    if data == "admin:pkg:import":
        context.user_data[ADMIN_MODE_KEY] = True
        _set_admin_state(context, "waiting_csv_import")
        if query.message:
            await query.message.reply_text(
                "Send a package CSV file.",
                reply_markup=admin_menu_keyboard(),
            )
        return

    if data == "admin:pkg:view":
        if query.message:
            fake_update = Update(update_id=update.update_id, message=query.message)
            await _view_packages(fake_update)
        return

    if data == "admin:broadcast:cancel":
        _set_admin_state(context, None)
        context.user_data.pop(BROADCAST_TEXT_KEY, None)
        await query.edit_message_text("Broadcast cancelled.")
        if query.message:
            await query.message.reply_text(
                "Admin menu:",
                reply_markup=admin_menu_keyboard(),
            )
        return

    if data == "admin:broadcast:send":
        await _send_broadcast(update, context)
        return


async def _fix_ask_multiplier_from_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Callback path for admin:pkg:auto."""
    query = update.callback_query
    if not query or not query.message:
        return
    _set_admin_state(context, "waiting_multiplier")
    await query.message.reply_text(
        "Send the MMK multiplier (e.g. 90).\n\n"
        "Formula: round(smile_coin × multiplier, nearest 100)\n"
        "Example: 39 × 90 = 3510 → 3500 MMK",
        reply_markup=admin_menu_keyboard(),
    )


async def admin_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Handle admin text input. Returns True if consumed."""
    if not update.message or not update.effective_user:
        return False
    user = update.effective_user
    if not is_admin(user.id):
        return False

    in_admin = context.user_data.get(ADMIN_MODE_KEY) or context.user_data.get(
        ADMIN_STATE_KEY
    )
    if not in_admin:
        return False

    text = _input_text(update)

    if text == BTN_EXIT:
        await _exit_admin(update, context)
        return True
    if text == BTN_USERS:
        context.user_data[ADMIN_MODE_KEY] = True
        _set_admin_state(context, None)
        await _show_users(update)
        return True
    if text == BTN_PACKAGES:
        context.user_data[ADMIN_MODE_KEY] = True
        _set_admin_state(context, None)
        await _show_packages_menu(update)
        return True
    if text == BTN_NOTIFY:
        context.user_data[ADMIN_MODE_KEY] = True
        await _ask_broadcast(update, context)
        return True
    if text == BTN_KBZ_SESSION:
        context.user_data[ADMIN_MODE_KEY] = True
        await _ask_kbz_session(update, context)
        return True

    state = context.user_data.get(ADMIN_STATE_KEY)
    if state == "waiting_kbz_pin":
        await _handle_kbz_pin(update, context, text)
        return True
    if state == "waiting_multiplier":
        await _handle_multiplier(update, context, text)
        return True
    if state == "waiting_broadcast":
        if not text.strip():
            await update.message.reply_text("Message cannot be empty.")
            return True
        await _preview_broadcast(update, context, text)
        return True
    if state == "waiting_csv_import":
        await update.message.reply_text(
            "Waiting for a CSV file — send it as a document, not plain text."
        )
        return True
    if state == "waiting_kbz_session":
        await update.message.reply_text(
            "Waiting for kbz_session.json — send it as a document, not plain text."
        )
        return True

    if context.user_data.get(ADMIN_MODE_KEY):
        await update.message.reply_text(
            "Use the admin menu or /admin.",
            reply_markup=admin_menu_keyboard(),
        )
        return True

    return False


async def admin_document_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Handle CSV package import or KBZ session upload."""
    if not update.message or not update.effective_user or not update.message.document:
        return False
    if not is_admin(update.effective_user.id):
        return False

    state = context.user_data.get(ADMIN_STATE_KEY)
    doc = update.message.document
    name = (doc.file_name or "").lower()

    if state in ("waiting_kbz_session", "waiting_kbz_pin"):
        if not (name.endswith(".json") or "kbz" in name or name.endswith(".txt")):
            if state == "waiting_kbz_pin":
                await update.message.reply_text(
                    "Waiting for 6-digit PIN, or send a new .json session file."
                )
            else:
                await update.message.reply_text(
                    "Please send a .json session file (e.g. kbz_session.json)."
                )
            return True
        tg_file = await doc.get_file()
        content = bytes(await tg_file.download_as_bytearray())
        await _import_kbz_session_bytes(update, context, content)
        return True

    if state != "waiting_csv_import":
        return False

    if not name.endswith(".csv"):
        await update.message.reply_text("Please send a .csv file.")
        return True

    tg_file = await doc.get_file()
    content = bytes(await tg_file.download_as_bytearray())
    await _import_csv_bytes(
        update,
        context,
        content,
        filename=doc.file_name or "packages.csv",
    )
    return True


async def route_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from bot.handlers.shop import menu_message

    if await admin_text_message(update, context):
        return
    await menu_message(update, context)


async def route_document_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await admin_document_message(update, context)

