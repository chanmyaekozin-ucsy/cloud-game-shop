"""Pin Smile.one coin balance in the proofs group (KBZ monitoring is Payment Manager only)."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from telegram import Bot
from telegram.error import BadRequest

from bot import config
from providers.smileone.auth import SmileAuthError
from providers.smileone.client import SmileOneClient
from providers.smileone.config import PROJECT_ROOT

logger = logging.getLogger("cloud_gameshop.monitor")

MMT = timezone(timedelta(hours=6, minutes=30))
_PIN_STATE_PATH = PROJECT_ROOT / ".data" / "monitor_pin.json"


@dataclass
class BalanceSnapshot:
    smile_balance: str | None = None
    smile_error: str | None = None
    smile_relogin: bool = False


def _fetch_smile_balance() -> tuple[str | None, str | None, bool]:
    client = SmileOneClient(auto_relogin=True)
    try:
        return client.get_balance(), None, False
    except SmileAuthError as exc:
        msg = str(exc)
        if not _looks_like_auth_error(msg):
            return None, msg, False
        try:
            client.ensure_logged_in(force_browser=True)
            return client.get_balance(), None, True
        except SmileAuthError as retry_exc:
            return None, str(retry_exc), True


def _looks_like_auth_error(message: str) -> bool:
    m = message.lower()
    return any(
        kw in m
        for kw in (
            "401",
            "403",
            "session",
            "expired",
            "login",
            "auth",
            "phpsessid",
        )
    )


def fetch_balances_sync() -> BalanceSnapshot:
    snap = BalanceSnapshot()
    smile_bal, smile_err, smile_relogin = _fetch_smile_balance()
    snap.smile_balance = smile_bal
    snap.smile_error = smile_err
    snap.smile_relogin = smile_relogin
    return snap


def _status_line(ok: bool, detail: str) -> str:
    return f"{detail} {'✅' if ok else '⚠️'}"


def _monitor_interval_range() -> tuple[int, int]:
    lo = max(10, config.MONITOR_INTERVAL_MIN_SEC)
    hi = max(lo, config.MONITOR_INTERVAL_MAX_SEC)
    return lo, hi


def _next_monitor_delay() -> int:
    lo, hi = _monitor_interval_range()
    return random.randint(lo, hi)


def format_monitor_message(snap: BalanceSnapshot) -> str:
    now = datetime.now(MMT).strftime("%Y-%m-%d %H:%M:%S MMT")
    lo, hi = _monitor_interval_range()
    smile_every = f"{lo}–{hi}s" if lo != hi else f"{lo}s"
    lines = [
        "📊 Cloud Game Shop — Smile.one Balance",
        f"Updated: {now}",
        f"Refresh: {smile_every}",
        "",
    ]

    if snap.smile_error:
        lines.append(_status_line(False, f"Smile.one: {snap.smile_error}"))
    else:
        lines.append(_status_line(True, f"Smile.one: {snap.smile_balance or '—'}"))

    if snap.smile_relogin:
        lines.extend(["", "Smile session auto-refreshed"])

    return "\n".join(lines)


def _load_pin_state() -> tuple[int, int] | None:
    if not _PIN_STATE_PATH.is_file():
        return None
    try:
        data = json.loads(_PIN_STATE_PATH.read_text(encoding="utf-8"))
        chat_id = int(data["chat_id"])
        message_id = int(data["message_id"])
        return chat_id, message_id
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def _save_pin_state(chat_id: int, message_id: int) -> None:
    _PIN_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PIN_STATE_PATH.write_text(
        json.dumps({"chat_id": chat_id, "message_id": message_id}, indent=2) + "\n",
        encoding="utf-8",
    )


async def update_pinned_status(bot: Bot, text: str) -> None:
    gid = config.PAYMENTS_PROOFS_GROUP_ID
    if not gid:
        logger.warning("PAYMENTS_PROOFS_GROUP_ID not set — monitor status not posted")
        return

    state = _load_pin_state()
    if state and state[0] == gid:
        try:
            await bot.edit_message_text(
                chat_id=gid,
                message_id=state[1],
                text=text,
                disable_web_page_preview=True,
            )
            return
        except BadRequest as exc:
            err = str(exc).lower()
            if "message is not modified" in err:
                return
            logger.warning("Monitor edit failed (%s) — sending new pinned message", exc)
        except Exception:
            logger.exception("Monitor edit failed — sending new pinned message")

    try:
        msg = await bot.send_message(
            chat_id=gid,
            text=text,
            disable_web_page_preview=True,
        )
    except Exception:
        logger.exception("Failed to post monitor status to proofs group")
        return

    try:
        await bot.pin_chat_message(
            chat_id=gid,
            message_id=msg.message_id,
            disable_notification=True,
        )
    except Exception:
        logger.exception(
            "Posted monitor status but could not pin (bot needs pin permission in group)"
        )

    _save_pin_state(gid, msg.message_id)


async def run_monitor_tick(bot: Bot) -> None:
    snap = await asyncio.to_thread(fetch_balances_sync)
    text = format_monitor_message(snap)
    await update_pinned_status(bot, text)
    if snap.smile_error:
        logger.warning("Monitor tick: smile=%s", snap.smile_error)
    else:
        logger.info("Monitor tick OK — smile=%s", snap.smile_balance)


async def balance_monitor_loop(bot: Bot) -> None:
    lo, hi = _monitor_interval_range()
    logger.info(
        "Smile.one balance monitor started (%s–%ss → proofs group pin)",
        lo,
        hi,
    )
    await asyncio.sleep(5)
    while True:
        try:
            await run_monitor_tick(bot)
        except Exception:
            logger.exception("Balance monitor tick failed")
        delay = _next_monitor_delay()
        logger.debug("Next monitor tick in %ss", delay)
        await asyncio.sleep(delay)
