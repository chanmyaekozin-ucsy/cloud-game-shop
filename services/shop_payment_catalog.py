"""Read-only shop payment catalog (Payment Manager is the sole writer)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from bot import config

logger = logging.getLogger(__name__)

SHOP_ID = "cloud_gameshop"


def catalog_path() -> Path:
    return Path(config.SHOP_PAYMENT_ACCOUNTS_PATH)


def load_catalog() -> dict[str, Any] | None:
    path = catalog_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to read shop payment catalog at %s", path)
        return None
    return raw if isinstance(raw, dict) else None


def enabled_accounts() -> list[dict[str, Any]]:
    data = load_catalog()
    if not data:
        return []
    out: list[dict[str, Any]] = []
    for acct in data.get("accounts") or []:
        if not isinstance(acct, dict):
            continue
        shop = (acct.get("shops") or {}).get(SHOP_ID) or {}
        if not (shop.get("enabled") and acct.get("session_valid")):
            continue
        method = str(acct.get("method") or "").strip()
        if method not in ("KBZPay", "WavePay"):
            continue
        out.append(
            {
                "id": acct.get("id"),
                "method": method,
                "account_number": str(acct.get("msisdn") or "").strip(),
                "account_name": str(acct.get("display_name") or "").strip(),
            }
        )
    return out


def enabled_methods() -> list[str]:
    methods: list[str] = []
    for acct in enabled_accounts():
        method = acct["method"]
        if method not in methods:
            methods.append(method)
    return methods


def account_for_method(method: str) -> dict[str, Any] | None:
    for acct in enabled_accounts():
        if acct["method"] == method:
            return acct
    return None
