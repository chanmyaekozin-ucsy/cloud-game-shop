"""Refresh Smile.one + KBZ balances and pin live status in the proofs group."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from telegram import Bot
from telegram.error import BadRequest

from bot import config
from payments.kbz.kbz_client import KBZClient, load_session
from payments.kbz.session_store import try_refresh_token_from_log
from payments.kbz.verify import _is_token_error
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
    kbz_balance: str | None = None
    kbz_available: str | None = None
    kbz_currency: str = "MMK"
    kbz_error: str | None = None
    kbz_refreshed: bool = False


def _parse_kbz_balance(data: dict[str, Any]) -> tuple[str | None, str | None, str]:
    bal = data.get("queryAccountBalanceResponse") or {}
    if not isinstance(bal, dict):
        bal = data
    currency = str(bal.get("currency") or "MMK")
    balance = bal.get("balance")
    available = bal.get("availableBalance") or balance
    if balance is None and available is None:
        for key in ("balance", "availableBalance", "totalBalance"):
            if data.get(key) is not None:
                balance = data.get(key)
                available = data.get("availableBalance") or balance
                break
    return (
        _format_amount(balance),
        _format_amount(available),
        currency,
    )


def _format_amount(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        num = float(text.replace(",", ""))
        if num.is_integer():
            return f"{int(num):,}"
        return f"{num:,.2f}"
    except ValueError:
        return text


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


def _fetch_kbz_balance() -> tuple[str | None, str | None, str, str | None, bool]:
    session_path = Path(config.KBZ_SESSION_PATH)
    log_path = _kbz_log_path()
    refreshed = False

    if log_path:
        changed, _ = try_refresh_token_from_log(session_path, log_path)
        refreshed = refreshed or changed

    session = load_session(session_path)
    if not session:
        return None, None, "MMK", "KBZ session file missing", refreshed

    def _query() -> dict[str, Any]:
        return KBZClient(session, timeout=20.0).fetch_balance()

    try:
        data = _query()
    except Exception as exc:
        msg = str(exc)
        if _is_token_error(msg) and log_path:
            changed, _ = try_refresh_token_from_log(session_path, log_path)
            if changed:
                refreshed = True
                session = load_session(session_path)
                if session:
                    try:
                        data = KBZClient(session, timeout=20.0).fetch_balance()
                        bal, avail, currency = _parse_kbz_balance(data)
                        return bal, avail, currency, None, refreshed
                    except Exception as retry_exc:
                        return None, None, "MMK", str(retry_exc), refreshed
        return None, None, "MMK", msg, refreshed

    bal, avail, currency = _parse_kbz_balance(data)
    return bal, avail, currency, None, refreshed


def fetch_balances_sync() -> BalanceSnapshot:
    snap = BalanceSnapshot()
    smile_bal, smile_err, smile_relogin = _fetch_smile_balance()
    snap.smile_balance = smile_bal
    snap.smile_error = smile_err
    snap.smile_relogin = smile_relogin

    kbz_bal, kbz_avail, kbz_cur, kbz_err, kbz_ref = _fetch_kbz_balance()
    snap.kbz_balance = kbz_bal
    snap.kbz_available = kbz_avail
    snap.kbz_currency = kbz_cur
    snap.kbz_error = kbz_err
    snap.kbz_refreshed = kbz_ref
    return snap


def _kbz_log_path() -> Path | None:
    raw = config.KBZ_FRIDA_LOG_PATH.strip()
    return Path(raw) if raw else None


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
    every = f"{lo}–{hi}s" if lo != hi else f"{lo}s"
    lines = [
        "📊 Cloud Game Shop — Balance Monitor",
        f"Updated: {now} (refresh {every})",
        "",
    ]

    if snap.smile_error:
        lines.append(_status_line(False, f"Smile.one: {snap.smile_error}"))
    else:
        lines.append(_status_line(True, f"Smile.one: {snap.smile_balance or '—'}"))

    if snap.kbz_error:
        lines.append(_status_line(False, f"KBZ Pay: {snap.kbz_error}"))
    elif snap.kbz_balance:
        kbz_line = f"KBZ Pay: {snap.kbz_balance} {snap.kbz_currency}"
        if snap.kbz_available and snap.kbz_available != snap.kbz_balance:
            kbz_line += f" (available {snap.kbz_available})"
        lines.append(_status_line(True, kbz_line))
    else:
        lines.append(_status_line(False, "KBZ Pay: balance unavailable"))

    notes: list[str] = []
    if snap.smile_relogin:
        notes.append("Smile session auto-refreshed")
    if snap.kbz_refreshed:
        notes.append("KBZ token refreshed from capture log")
    if notes:
        lines.extend(["", " · ".join(notes)])

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
    if snap.smile_error or snap.kbz_error:
        logger.warning(
            "Monitor tick: smile=%s kbz=%s",
            snap.smile_error or "ok",
            snap.kbz_error or "ok",
        )
    else:
        logger.info("Monitor tick OK — smile=%s kbz=%s", snap.smile_balance, snap.kbz_balance)


async def balance_monitor_loop(bot: Bot) -> None:
    lo, hi = _monitor_interval_range()
    logger.info("Balance monitor started (%s–%ss random, proofs group pin)", lo, hi)
    await asyncio.sleep(5)
    while True:
        try:
            await run_monitor_tick(bot)
        except Exception:
            logger.exception("Balance monitor tick failed")
        delay = _next_monitor_delay()
        logger.debug("Next monitor tick in %ss", delay)
        await asyncio.sleep(delay)
