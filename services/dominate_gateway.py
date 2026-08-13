"""Dominate Payment Gateway HTTP client (per-project API key)."""
from __future__ import annotations

import logging
from typing import Any

import requests

from bot import config

logger = logging.getLogger(__name__)


def gateway_configured() -> bool:
    return bool(
        getattr(config, "DOMINATE_GATEWAY_URL", "").strip()
        and getattr(config, "DOMINATE_GATEWAY_API_KEY", "").strip()
    )


def _base() -> str:
    return str(config.DOMINATE_GATEWAY_URL).rstrip("/")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {config.DOMINATE_GATEWAY_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def list_payment_methods(timeout: float = 20.0) -> list[dict[str, Any]]:
    url = f"{_base()}/v1/payment-methods"
    resp = requests.get(url, headers=_headers(), timeout=timeout)
    resp.raise_for_status()
    data = resp.json() or {}
    out: list[dict[str, Any]] = []
    for acct in data.get("accounts") or []:
        if not isinstance(acct, dict):
            continue
        method = str(acct.get("method") or "").strip()
        if method not in ("KBZPay", "WavePay"):
            continue
        out.append(
            {
                "id": acct.get("id"),
                "method": method,
                "provider": str(acct.get("provider") or ""),
                "account_number": str(acct.get("msisdn") or "").strip(),
                "account_name": str(acct.get("display_name") or "").strip(),
            }
        )
    return out


def create_deposit(
    *,
    account_id: str,
    amount_ks: int,
    external_ref: str,
    callback_url: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "account_id": account_id,
        "amount_ks": int(amount_ks),
        "external_ref": external_ref,
    }
    if callback_url:
        payload["callback_url"] = callback_url
    url = f"{_base()}/v1/deposits"
    resp = requests.post(url, headers=_headers(), json=payload, timeout=timeout)
    if resp.status_code >= 400:
        detail = ""
        try:
            detail = str((resp.json() or {}).get("detail") or resp.text)
        except Exception:
            detail = resp.text
        raise RuntimeError(detail or f"HTTP {resp.status_code}")
    return resp.json()


def get_deposit(deposit_id: str, timeout: float = 25.0) -> dict[str, Any]:
    url = f"{_base()}/v1/deposits/{deposit_id}"
    resp = requests.get(url, headers=_headers(), timeout=timeout)
    if resp.status_code == 404:
        raise RuntimeError("Deposit not found")
    if resp.status_code >= 400:
        detail = ""
        try:
            detail = str((resp.json() or {}).get("detail") or resp.text)
        except Exception:
            detail = resp.text
        raise RuntimeError(detail or f"HTTP {resp.status_code}")
    return resp.json()
