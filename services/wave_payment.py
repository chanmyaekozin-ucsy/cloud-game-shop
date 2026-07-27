"""Async wrapper for WavePay verification (last-5 digits)."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

from bot import config
from payments.wave.verify import VerifyResult, load_verifier


def _verifier():
    if not config.WAVE_AUTO_VERIFY:
        return None
    path = Path(config.WAVE_SESSION_PATH)
    if not path.is_file():
        return None
    return load_verifier(
        path,
        config.WAVE_MERCHANT_NAME,
        config.WAVE_MERCHANT_PHONE,
        max_age_hours=config.PAYMENT_TX_MAX_AGE_HOURS,
        proxy=config.WAVE_HTTP_PROXY,
        verify_ssl=config.WAVE_VERIFY_SSL,
    )


async def verify_last5_digits(suffix: str, expected_ks: int) -> VerifyResult:
    suffix = re.sub(r"\D", "", suffix)
    if len(suffix) != 5:
        return VerifyResult("failed", "Enter exactly 5 digits")

    path = Path(config.WAVE_SESSION_PATH)
    if not path.is_file():
        return VerifyResult("error", "Wave session file not found")

    def _search() -> VerifyResult:
        v = _verifier()
        if not v:
            return VerifyResult("error", "Wave auto-verify not configured")
        return v.verify_last5(suffix, expected_ks)

    return await asyncio.to_thread(_search)
