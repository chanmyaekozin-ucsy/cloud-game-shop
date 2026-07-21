"""Post order/payment updates to the proofs Telegram group."""

from __future__ import annotations

import logging
from typing import Literal

from telegram import Bot, InlineKeyboardMarkup

import database as db
from bot import config
from bot.keyboards import group_proof_actions

logger = logging.getLogger("cloud_gameshop.proofs")

ProofStatus = Literal[
    "verifying",
    "auto_approved",
    "payment_failed",
    "manual_review",
    "approved",
    "rejected",
    "completed",
    "topup_failed",
    "processing",
]

_STATUS_HEADING = {
    "verifying": "Verifying…",
    "auto_approved": "Payment Verified — Processing",
    "payment_failed": "Payment Failed",
    "manual_review": "Manual Review Required",
    "approved": "Accepted by Admin — Processing",
    "rejected": "Declined by Admin",
    "completed": "Completed",
    "topup_failed": "Top-up Failed",
    "processing": "Processing",
}


def build_proof_caption(
    order: dict,
    user: dict,
    status: ProofStatus | str,
    *,
    note: str = "",
) -> str:
    username = user.get("username")
    user_line = f"@{username}" if username else "—"
    heading = _STATUS_HEADING.get(status, str(status))
    lines = [
        f"Cloud Game Shop — {heading}",
        "",
        f"Order #{order['id']}",
        f"Plan: {order['package_name']}",
        f"Amount: {order['amount_ks']:,} Ks",
        f"Game: {order['game_id']}({order['server_id']})",
        f"Nickname: {order.get('nickname') or '—'}",
        f"Region: {order.get('region') or '—'}",
        f"User: {user.get('first_name') or '—'} ({user_line})",
        f"Telegram ID: {user.get('telegram_id')}",
    ]
    if order.get("kbz_trans_id"):
        lines.append(f"KBZ Tx: {order['kbz_trans_id']}")
    if note:
        lines.extend(["", note])
    return "\n".join(lines)


def _show_actions(status: ProofStatus | str, order: dict) -> bool:
    if order.get("status") != "manual_review":
        return False
    return status == "manual_review"


async def post_order_proof(
    bot: Bot,
    *,
    order: dict,
    user: dict,
    status: str,
    note: str = "",
) -> int | None:
    if not config.PAYMENTS_PROOFS_GROUP_ID:
        logger.warning("PAYMENTS_PROOFS_GROUP_ID not set — skipping proof post")
        return None

    caption = build_proof_caption(order, user, status, note=note)
    markup: InlineKeyboardMarkup | None = None
    if _show_actions(status, order):
        markup = group_proof_actions(int(order["id"]))

    try:
        msg = await bot.send_message(
            chat_id=config.PAYMENTS_PROOFS_GROUP_ID,
            text=caption,
            reply_markup=markup,
        )
        await db.save_proof_message(
            int(order["id"]), config.PAYMENTS_PROOFS_GROUP_ID, msg.message_id
        )
        return msg.message_id
    except Exception:
        logger.exception("Failed to post proof to group")
        return None


async def update_order_proof(
    bot: Bot,
    order_id: int,
    status: ProofStatus | str,
    *,
    note: str = "",
) -> None:
    """Update an existing proofs-group message text and action buttons."""
    row = await db.get_order_with_user(order_id)
    if not row:
        return

    user = {
        "telegram_id": row.get("telegram_id"),
        "username": row.get("username"),
        "first_name": row.get("first_name"),
    }
    chat_id = row.get("proof_chat_id") or config.PAYMENTS_PROOFS_GROUP_ID
    message_id = row.get("proof_message_id")
    if not chat_id or not message_id:
        await post_order_proof(
            bot, order=row, user=user, status=status, note=note
        )
        return

    caption = build_proof_caption(row, user, status, note=note)
    markup: InlineKeyboardMarkup | None = None
    if _show_actions(status, row):
        markup = group_proof_actions(order_id)

    try:
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=message_id,
            text=caption,
            reply_markup=markup,
        )
    except Exception:
        logger.exception("Failed to update order proof #%s in group", order_id)
