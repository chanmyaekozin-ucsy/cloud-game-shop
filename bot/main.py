#!/usr/bin/env python3
"""Cloud Game Shop Telegram bot."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters
from telegram.request import HTTPXRequest

import database as db
from bot import config
from bot.handlers.admin import (
    admin_callback,
    cmd_admin,
    route_document_message,
    route_text_message,
)
from bot.handlers.group_payment import build_group_payment_handlers
from bot.handlers.shop import callback_query, cmd_cancel, cmd_start

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("cloud_gameshop")


async def post_init(application: Application) -> None:
    await db.init_db()
    logger.info("Database ready: %s", config.SQLITE_PATH)
    if config.MONITOR_ENABLED and config.PAYMENTS_PROOFS_GROUP_ID:
        import asyncio

        from services.balance_monitor import balance_monitor_loop

        asyncio.create_task(balance_monitor_loop(application.bot))
        logger.info(
            "Smile.one balance monitor enabled (%s–%ss random → proofs group)",
            config.MONITOR_INTERVAL_MIN_SEC,
            config.MONITOR_INTERVAL_MAX_SEC,
        )
    elif config.MONITOR_ENABLED:
        logger.warning(
            "MONITOR_ENABLED but PAYMENTS_PROOFS_GROUP_ID is unset — monitor skipped"
        )
    logger.info("Bot is ready — send /start in Telegram")


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    from telegram.error import Conflict

    if isinstance(context.error, Conflict):
        logger.error(
            "Telegram 409 Conflict: another bot instance is polling. "
            "Stop all other bot/main.py processes and use scripts/run_bot.sh only."
        )
        return
    logger.exception("Unhandled bot error (update=%s)", update, exc_info=context.error)


def _telegram_request(*, connection_pool_size: int) -> HTTPXRequest:
    return HTTPXRequest(
        connect_timeout=config.TELEGRAM_CONNECT_TIMEOUT,
        read_timeout=config.TELEGRAM_READ_TIMEOUT,
        write_timeout=config.TELEGRAM_WRITE_TIMEOUT,
        pool_timeout=config.TELEGRAM_POOL_TIMEOUT,
        proxy=config.TELEGRAM_PROXY_URL,
        connection_pool_size=connection_pool_size,
    )


def _build_application() -> Application:
    # Separate HTTP clients: long-polling getUpdates must not block sendMessage.
    bot_request = _telegram_request(connection_pool_size=8)
    updates_request = _telegram_request(connection_pool_size=1)
    builder = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .request(bot_request)
        .get_updates_request(updates_request)
        .post_init(post_init)
        .concurrent_updates(False)
    )
    if config.TELEGRAM_PROXY_URL:
        logger.info("Using Telegram proxy: %s", config.TELEGRAM_PROXY_URL)
    return builder.build()


def main() -> None:
    config.validate_config()
    app = _build_application()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_start))
    app.add_handler(CommandHandler("cancel", cmd_cancel))
    app.add_handler(CommandHandler("admin", cmd_admin))
    app.add_handler(CallbackQueryHandler(admin_callback, pattern=r"^admin:"))
    # Group Accept/Decline before shop callbacks (same pattern as AirVPN).
    for handler in build_group_payment_handlers():
        app.add_handler(handler, group=-1)
    app.add_handler(CallbackQueryHandler(callback_query))
    app.add_handler(
        MessageHandler(
            filters.Document.ALL,
            route_document_message,
        )
    )
    app.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            route_text_message,
        )
    )
    app.add_error_handler(on_error)

    logger.info("Cloud Game Shop bot starting…")
    app.run_polling(
        drop_pending_updates=True,
        allowed_updates=["message", "callback_query"],
    )


if __name__ == "__main__":
    main()
