"""KBZ Pay verification for Cloud Game Shop."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from bot import config
from payments.kbz.kbz_client import HistoryCursor, KBZClient, load_session
from payments.kbz.verify import KbzPaymentVerifier, VerifyResult, load_verifier


def _verifier() -> KbzPaymentVerifier | None:
    if not config.KBZ_AUTO_VERIFY:
        return None
    path = Path(config.KBZ_SESSION_PATH)
    if not path.is_file():
        return None
    return load_verifier(path, config.KBZ_MERCHANT_NAME, config.KBZ_MERCHANT_PHONE)


async def verify_transaction_id(trans_id: str, expected_ks: int) -> VerifyResult:
    v = _verifier()
    if not v:
        return VerifyResult("error", "KBZ auto-verify not configured")
    return await asyncio.to_thread(v.verify_transaction_id, trans_id, expected_ks)


async def verify_last5_digits(suffix: str, expected_ks: int) -> VerifyResult:
    """Find a recent KBZ transaction whose ID ends with the given 5 digits."""
    suffix = re.sub(r"\D", "", suffix)
    if len(suffix) != 5:
        return VerifyResult("failed", "Enter exactly 5 digits")

    path = Path(config.KBZ_SESSION_PATH)
    if not path.is_file():
        return VerifyResult("error", "KBZ session file not found")

    def _search() -> VerifyResult:
        from payments.kbz.verify import _is_token_error

        v = _verifier()
        if not v:
            return VerifyResult("error", "KBZ auto-verify not configured")
        client = v._get_client()
        cursor = HistoryCursor()
        checked: set[str] = set()
        saw_need_pin = False
        try:
            for _ in range(8):
                page = client.fetch_transaction_page(cursor=cursor)
                if str(page.get("needVerifyPin") or "").lower() in ("true", "1", "yes"):
                    saw_need_pin = True
                records = page.get("transRecordList") or []
                if not records:
                    break
                for rec in records:
                    oid = str(rec.get("orderId") or rec.get("transId") or "")
                    if not oid or oid in checked:
                        continue
                    checked.add(oid)
                    if not oid.endswith(suffix):
                        continue
                    result = v.verify_transaction_id(oid, expected_ks)
                    if result.status == "ok":
                        return result
                    if result.status in ("token_invalid", "error"):
                        return result
                cursor.apply_page(records)
                if len(records) < 10:
                    break
        except Exception as exc:
            msg = str(exc)
            if _is_token_error(msg):
                return VerifyResult(
                    "token_invalid",
                    "KBZ session expired (logged in on another device). "
                    "Pull a fresh session and upload again — keep KBZPay closed on the phone.",
                )
            return VerifyResult("error", f"KBZ history error: {msg}")

        if saw_need_pin and not checked:
            return VerifyResult(
                "error",
                "KBZ history locked (needVerifyPin). "
                "Admin: upload session → enter PIN when prompted.",
            )
        return VerifyResult(
            "failed",
            f"No matching KBZ payment ending in {suffix} for {expected_ks:,} Ks",
        )

    return await asyncio.to_thread(_search)
