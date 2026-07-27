"""WavePay payment verification — last-5 digits via merchant history."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from payments.wave.wave_client import WaveClient, load_session, save_session

logger = logging.getLogger(__name__)

VerifyStatus = Literal["ok", "failed", "error", "token_invalid"]

MMT = timezone(timedelta(hours=6, minutes=30))


@dataclass
class VerifyResult:
    status: VerifyStatus
    message: str
    trans_id: str | None = None
    amount_ks: int | None = None
    receiver: str | None = None


def _parse_amount_ks(raw: Any) -> int | None:
    if raw is None:
        return None
    text = str(raw).replace(",", "").strip()
    m = re.search(r"-?[\d]+(?:\.\d+)?", text)
    if not m:
        return None
    try:
        return int(abs(float(m.group())))
    except ValueError:
        return None


def _parse_trans_date(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    # Wave uses e.g. 2026-07-27 or ISO-ish strings
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(text[:19], fmt)
            return dt.replace(tzinfo=MMT)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_auth_error(message: str) -> bool:
    m = (message or "").lower()
    return any(
        kw in m
        for kw in (
            "401",
            "403",
            "unauthorized",
            "wmt-mfs",
            "session",
            "expired",
            "forbidden",
        )
    )


class WavePaymentVerifier:
    def __init__(
        self,
        session_path: Path | str,
        *,
        merchant_name: str = "",
        merchant_phone: str = "",
        max_age_hours: int = 2,
        proxy: str | None = None,
        verify_ssl: bool = True,
    ):
        self.session_path = Path(session_path)
        self.merchant_name = (merchant_name or "").strip()
        self.merchant_phone = re.sub(r"\D", "", merchant_phone or "")
        self.max_age_hours = max(1, int(max_age_hours))
        self.proxy = proxy
        self.verify_ssl = verify_ssl

    def _client(self) -> WaveClient:
        session = load_session(self.session_path)
        if not session or not session.wmt_mfs:
            raise RuntimeError("Wave session missing or has no wmt_mfs")
        return WaveClient(
            session,
            timeout=25.0,
            proxy=self.proxy,
            verify_ssl=self.verify_ssl,
        )

    def verify_last5(self, suffix: str, expected_ks: int) -> VerifyResult:
        suffix = re.sub(r"\D", "", suffix)
        if len(suffix) != 5:
            return VerifyResult("failed", "Enter exactly 5 digits")
        if expected_ks <= 0:
            return VerifyResult("failed", "Invalid expected amount")

        try:
            client = self._client()
        except Exception as exc:
            msg = str(exc)
            if _is_auth_error(msg):
                return VerifyResult(
                    "token_invalid",
                    "Wave session expired. Renew login in Donimate Payment Manager.",
                )
            return VerifyResult("error", f"Wave session error: {msg}")

        checked: set[str] = set()
        try:
            for page_i in range(8):
                offset = page_i * 20
                body = client.tnx_histories(limit=20, offset=offset)
                rm = body.get("responseMap") or {}
                records = rm.get("tnxHistoryList") or []
                if not isinstance(records, list) or not records:
                    break
                for rec in records:
                    if not isinstance(rec, dict):
                        continue
                    tid = str(rec.get("transId") or "")
                    if not tid or tid in checked:
                        continue
                    checked.add(tid)
                    if not tid.endswith(suffix):
                        continue
                    result = self._match_record(client, rec, expected_ks)
                    if result.status == "ok":
                        try:
                            save_session(self.session_path, client.session)
                        except Exception:
                            pass
                        return result
                    if result.status in ("token_invalid", "error"):
                        return result
                if len(records) < 20:
                    break
            try:
                save_session(self.session_path, client.session)
            except Exception:
                pass
        except Exception as exc:
            msg = str(exc)
            logger.warning("Wave history verify failed: %s", msg)
            if _is_auth_error(msg):
                return VerifyResult(
                    "token_invalid",
                    "Wave session expired. Renew login in Donimate Payment Manager.",
                )
            return VerifyResult("error", f"Wave history error: {msg}")

        return VerifyResult(
            "failed",
            f"No matching Wave payment ending in {suffix} for {expected_ks:,} Ks",
        )

    def _match_record(
        self, client: WaveClient, rec: dict[str, Any], expected_ks: int
    ) -> VerifyResult:
        tid = str(rec.get("transId") or "")
        amt = _parse_amount_ks(rec.get("amount"))
        if amt is None or amt != expected_ks:
            return VerifyResult("failed", "Amount mismatch")

        # Merchant credits are positive; outbound sends are negative.
        try:
            signed = float(rec.get("amount") or 0)
        except (TypeError, ValueError):
            signed = 0.0
        if signed < 0:
            return VerifyResult("failed", "Not an inbound Wave transfer")

        trans_date = str(rec.get("transDate") or "")
        when = _parse_trans_date(trans_date)
        if when:
            age = datetime.now(MMT) - when.astimezone(MMT)
            if age > timedelta(hours=self.max_age_hours):
                return VerifyResult(
                    "failed",
                    f"Transfer older than {self.max_age_hours}h",
                )

        # Optional detail check for peer / status
        detail_name = ""
        if tid and trans_date:
            day = trans_date[:10]
            try:
                detail = client.tnx_history_detail(tid, day)
                drm = (detail.get("responseMap") or {}).get("tnxHistoryDetails") or {}
                if isinstance(drm, dict):
                    detail_name = str(
                        drm.get("senderName")
                        or drm.get("receiverName")
                        or drm.get("name")
                        or ""
                    )
                    d_amt = _parse_amount_ks(drm.get("amount") or drm.get("transAmount"))
                    if d_amt is not None and d_amt != expected_ks:
                        return VerifyResult("failed", "Detail amount mismatch")
            except Exception as exc:
                logger.debug("Wave detail fetch skipped: %s", exc)

        return VerifyResult(
            "ok",
            "Wave payment matched",
            trans_id=tid,
            amount_ks=expected_ks,
            receiver=detail_name or self.merchant_name or None,
        )


def load_verifier(
    session_path: Path | str,
    merchant_name: str = "",
    merchant_phone: str = "",
    *,
    max_age_hours: int = 2,
    proxy: str | None = None,
    verify_ssl: bool = True,
) -> WavePaymentVerifier:
    return WavePaymentVerifier(
        session_path,
        merchant_name=merchant_name,
        merchant_phone=merchant_phone,
        max_age_hours=max_age_hours,
        proxy=proxy,
        verify_ssl=verify_ssl,
    )
