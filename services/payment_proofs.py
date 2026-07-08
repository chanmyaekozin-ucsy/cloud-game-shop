"""Post order/payment updates to the proofs Telegram group."""

from __future__ import annotations

import logging

from telegram import Bot

from bot import config

logger = logging.getLogger("cloud_gameshop.proofs")


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

    username = user.get("username")
    user_line = f"@{username}" if username else "—"
    lines = [
        f"Cloud Game Shop — {status}",
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

    try:
        msg = await bot.send_message(
            chat_id=config.PAYMENTS_PROOFS_GROUP_ID,
            text="\n".join(lines),
        )
        return msg.message_id
    except Exception:
        logger.exception("Failed to post proof to group")
        return None
