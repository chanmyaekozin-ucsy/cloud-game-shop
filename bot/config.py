"""Bot configuration."""

from __future__ import annotations

import os
from pathlib import Path

from providers.smileone.config import PROJECT_ROOT, load_env

load_env()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()

ADMIN_USER_IDS: set[int] = set()
for part in os.environ.get("TELEGRAM_ADMIN_IDS", "").split(","):
    part = part.strip()
    if part.isdigit():
        ADMIN_USER_IDS.add(int(part))

TELEGRAM_ADMIN_USERNAME = os.environ.get("TELEGRAM_ADMIN_USERNAME", "").strip().lstrip("@")


def admin_contact_url() -> str | None:
    if not TELEGRAM_ADMIN_USERNAME:
        return None
    return f"https://t.me/{TELEGRAM_ADMIN_USERNAME}"


def admin_contact_label() -> str:
    if TELEGRAM_ADMIN_USERNAME:
        return f"@{TELEGRAM_ADMIN_USERNAME}"
    return "Admin"

_proofs_raw = os.environ.get("PAYMENTS_PROOFS_GROUP_ID", "").strip()
PAYMENTS_PROOFS_GROUP_ID: int | None = (
    int(_proofs_raw) if _proofs_raw.lstrip("-").isdigit() else None
)

KBZ_AUTO_VERIFY = os.environ.get("KBZ_AUTO_VERIFY", "true").strip().lower() in (
    "1",
    "true",
    "yes",
)
KBZ_SESSION_PATH = os.environ.get(
    "KBZ_SESSION_PATH",
    str(PROJECT_ROOT / ".data" / "kbz_session.json"),
)
KBZ_MERCHANT_NAME = os.environ.get("KBZ_MERCHANT_NAME", "").strip()
KBZ_MERCHANT_PHONE = os.environ.get("KBZ_MERCHANT_PHONE", "").strip()
KBZ_PAY_DISPLAY_NAME = os.environ.get("KBZ_PAY_DISPLAY_NAME", KBZ_MERCHANT_NAME).strip()
KBZ_PAY_PHONE = os.environ.get("KBZ_PAY_PHONE", KBZ_MERCHANT_PHONE).strip()
KBZ_TX_EXAMPLE = os.environ.get("KBZ_TX_EXAMPLE", "82622").strip()
KBZ_SAMPLE_TX_IMAGE = Path(
    os.environ.get(
        "KBZ_SAMPLE_TX_IMAGE",
        str(PROJECT_ROOT / "data" / "sample_txid.jpg"),
    )
)
PAYMENT_TX_MAX_AGE_HOURS = int(os.environ.get("PAYMENT_TX_MAX_AGE_HOURS", "2"))
KBZ_FRIDA_LOG_PATH = os.environ.get("KBZ_FRIDA_LOG_PATH", "").strip()

MONITOR_ENABLED = os.environ.get("MONITOR_ENABLED", "true").strip().lower() in (
    "1",
    "true",
    "yes",
)
MONITOR_INTERVAL_MIN_SEC = int(os.environ.get("MONITOR_INTERVAL_MIN_SEC", "40"))
MONITOR_INTERVAL_MAX_SEC = int(os.environ.get("MONITOR_INTERVAL_MAX_SEC", "120"))

SQLITE_PATH = os.environ.get(
    "SQLITE_PATH",
    str(PROJECT_ROOT / ".data" / "cloud_gameshop.sqlite3"),
)

TELEGRAM_PROXY_URL = os.environ.get("TELEGRAM_PROXY_URL", "").strip() or None
TELEGRAM_CONNECT_TIMEOUT = float(os.environ.get("TELEGRAM_CONNECT_TIMEOUT", "30"))
TELEGRAM_READ_TIMEOUT = float(os.environ.get("TELEGRAM_READ_TIMEOUT", "30"))
TELEGRAM_WRITE_TIMEOUT = float(os.environ.get("TELEGRAM_WRITE_TIMEOUT", "30"))
TELEGRAM_POOL_TIMEOUT = float(os.environ.get("TELEGRAM_POOL_TIMEOUT", "30"))


def validate_config() -> None:
    if not BOT_TOKEN:
        raise RuntimeError(
            "TELEGRAM_BOT_TOKEN is not set. Add it to .env (see .env.example)."
        )
