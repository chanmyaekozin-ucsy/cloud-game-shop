"""Admin panel — users, package CSV workflow, broadcast.

KBZ session + payment accounts are managed only in Donimate Payment Manager.
This bot only reads the shared session for payment verify / balance monitor.
"""

from __future__ import annotations

import logging
from io import BytesIO

from telegram import InputFile, Update
from telegram.ext import ContextTypes

import database as db
from bot import i18n
from bot.keyboards import (
    admin_broadcast_confirm_inline,
    admin_menu_keyboard,
    admin_packages_inline,
    main_menu_keyboard,
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
BTN_NOTIFY = "📢 Notify"
BTN_EXIT = "🚪 Exit Admin"


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
        "• Notify — broadcast message to all users\n\n"
        "KBZ session / payment accounts → Donimate Payment Manager only.",
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
    if text in ("🔑 KBZ Session", "KBZ Session"):
        await update.message.reply_text(
            "KBZ session is managed only in Donimate Payment Manager.\n"
            "This shop bot only reads the shared session for payment verify.",
            reply_markup=admin_menu_keyboard(),
        )
        return True

    state = context.user_data.get(ADMIN_STATE_KEY)
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

    if context.user_data.get(ADMIN_MODE_KEY):
        await update.message.reply_text(
            "Use the admin menu or /admin.",
            reply_markup=admin_menu_keyboard(),
        )
        return True

    return False


async def admin_document_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Handle CSV package import only (KBZ session is Payment Manager only)."""
    if not update.message or not update.effective_user or not update.message.document:
        return False
    if not is_admin(update.effective_user.id):
        return False

    state = context.user_data.get(ADMIN_STATE_KEY)
    doc = update.message.document
    name = (doc.file_name or "").lower()

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

