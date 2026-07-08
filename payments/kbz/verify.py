"""KBZPay receipt verification — QR / transaction ID → PaymentInfo → match plan."""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from bot import config

from .kbz_client import KBZClient, KBZSession, load_session
from .kbz_qr import (
    enrich_parsed_from_scan,
    has_full_public_payment_info,
    parse_qr_input,
    tid_and_direction,
    verify_public_qr,
)
from .receipt_image import decode_qr_from_image

logger = logging.getLogger(__name__)

VerifyStatus = Literal["ok", "needs_tx_id", "failed", "error", "token_invalid"]

_AUTH_ERRORS = ("AS401", "AS402", "AS403")


def _is_token_error(message: str) -> bool:
    m = message.lower()
    if any(code in message for code in _AUTH_ERRORS):
        return True
    return any(
        kw in m
        for kw in (
            "stale token",
            "token invalid",
            "invalid token",
            "crypto mismatch",
            "api rejected request",
            "session expired",
        )
    )


@dataclass
class VerifyResult:
    status: VerifyStatus
    message: str
    trans_id: str | None = None
    amount_ks: int | None = None
    receiver: str | None = None
    qr_raw: str | None = None


def _digits_phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _parse_amount_ks(raw: Any) -> int | None:
    if raw is None:
        return None
    text = re.sub(r"<[^>]+>", "", str(raw))
    text = text.replace(",", "").strip()
    m = re.search(r"-?[\d]+(?:\.\d+)?", text)
    if not m:
        return None
    try:
        return int(abs(float(m.group())))
    except ValueError:
        return None


def _name_matches(haystack: str, expected_name: str) -> bool:
    if not haystack or not expected_name:
        return False
    h = haystack.lower().replace(" ", "")
    e = expected_name.lower().replace(" ", "")
    return e in h or h in e


def _phone_matches(haystack: str, expected_phone: str) -> bool:
    d1 = _digits_phone(haystack)
    d2 = _digits_phone(expected_phone)
    if not d1 or not d2:
        return False
    return d1.endswith(d2[-min(10, len(d2)) :]) or d2.endswith(d1[-min(10, len(d1)) :])


def stale_tx_message() -> str:
    hours = config.PAYMENT_TX_MAX_AGE_HOURS
    unit = "hour" if hours == 1 else "hours"
    return f"Transaction over {hours} {unit} old"


def is_stale_tx_failure(result: "VerifyResult") -> bool:
    return result.status == "failed" and result.message == stale_tx_message()


def _parse_time_ms(raw: Any) -> int | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text.isdigit():
        return None
    value = int(text)
    if value < 1_000_000_000_000:
        return value * 1000
    return value


def _extract_detail_trade_time_ms(detail: dict[str, Any]) -> int | None:
    for key in ("tradeTime", "tradeDate", "transTime", "createTime", "timestamp"):
        ts = _parse_time_ms(detail.get(key))
        if ts:
            return ts
    for field in detail.get("tradeDetail") or []:
        if not isinstance(field, dict):
            continue
        name = str(field.get("fieldName") or field.get("name") or "").lower()
        if "time" not in name and "date" not in name:
            continue
        ts = _parse_time_ms(field.get("fieldValue") or field.get("value"))
        if ts:
            return ts
    return None


def _stale_tx_result(
    trade_time_ms: int | None,
    server_time_ms: int | None,
    *,
    trans_id: str | None = None,
    amount_ks: int | None = None,
    receiver: str | None = None,
    qr_raw: str | None = None,
) -> VerifyResult | None:
    if trade_time_ms is None:
        return None
    now_ms = server_time_ms or int(time.time() * 1000)
    max_age_ms = config.PAYMENT_TX_MAX_AGE_HOURS * 3600 * 1000
    if now_ms - trade_time_ms <= max_age_ms:
        return None
    return VerifyResult(
        "failed",
        stale_tx_message(),
        trans_id=trans_id,
        amount_ks=amount_ks,
        receiver=receiver,
        qr_raw=qr_raw,
    )


class KbzPaymentVerifier:
    def __init__(
        self,
        session_path: Path,
        merchant_name: str,
        merchant_phone: str,
    ) -> None:
        self.session_path = session_path
        self.merchant_name = merchant_name.strip()
        self.merchant_phone = merchant_phone.strip()
        self._client: KBZClient | None = None

    def _get_client(self) -> KBZClient:
        if self._client:
            return self._client
        raw = json.loads(self.session_path.read_text(encoding="utf-8"))
        session = KBZSession.from_dict(raw)
        self._client = KBZClient(session)
        return self._client

    def _check_session(self) -> VerifyResult | None:
        """Return token_invalid if KBZ session cannot authenticate."""
        try:
            self._get_client().fetch_balance()
            return None
        except Exception as exc:
            msg = str(exc)
            if _is_token_error(msg):
                logger.warning("KBZ session token invalid: %s", msg)
                return VerifyResult("token_invalid", "KBZ session token invalid")
            logger.exception("KBZ session check failed")
            return None

    def _server_time_ms(self) -> int | None:
        try:
            bal = self._get_client().fetch_balance()
            ts = bal.get("serverTimestamp")
            return int(ts) if ts else None
        except Exception as exc:
            if _is_token_error(str(exc)):
                return None
            logger.exception("KBZ balance query failed")
            return None

    def _api_error_result(self, exc: Exception, trans_id: str | None = None) -> VerifyResult:
        msg = str(exc)
        if _is_token_error(msg):
            return VerifyResult("token_invalid", "KBZ session token invalid", trans_id=trans_id)
        return VerifyResult("error", f"KBZ API error: {msg}", trans_id=trans_id)

    def _match_merchant(self, receiver_text: str) -> bool:
        return _name_matches(receiver_text, self.merchant_name) or _phone_matches(
            receiver_text, self.merchant_phone
        )

    def _check_amount(self, found_ks: int | None, expected_ks: int) -> str | None:
        if found_ks is None:
            return "Amount not found on receipt"
        if found_ks != expected_ks:
            return f"Amount mismatch: receipt {found_ks:,} Ks, expected {expected_ks:,} Ks"
        return None

    def verify_qr_string(self, qr_raw: str, expected_ks: int) -> VerifyResult:
        parsed = parse_qr_input(qr_raw.strip())
        # Public bill QR may verify without API; check session only when API is needed.
        server_ts = self._server_time_ms()

        if parsed.get("kprsc") and not has_full_public_payment_info(
            verify_public_qr(parsed, server_time_ms=server_ts).payload
        ):
            session_err = self._check_session()
            if session_err:
                tid, _ = tid_and_direction(parsed)
                if tid:
                    return self.verify_trans_id(tid, expected_ks, debit_or_credit="C")
                return session_err
            try:
                scan_data = self._get_client().scan_qr_code2(qr_raw.strip(), scan_source="AirVPN")
                parsed, _ = enrich_parsed_from_scan(parsed, scan_data or {})
            except Exception as exc:
                err = self._api_error_result(exc)
                if err.status == "token_invalid":
                    tid, _ = tid_and_direction(parsed)
                    if tid:
                        return self.verify_trans_id(tid, expected_ks, debit_or_credit="C")
                    return err
                logger.warning("ScanQRCode2 failed: %s", exc)

        verify = verify_public_qr(parsed, server_time_ms=server_ts)
        if not verify.valid:
            tid, _ = tid_and_direction(parsed)
            if tid:
                return self.verify_trans_id(tid, expected_ks, debit_or_credit="C")
            return VerifyResult(
                status="needs_tx_id",
                message=verify.reason or "QR invalid or incomplete",
                qr_raw=qr_raw,
            )

        payload = verify.payload
        if has_full_public_payment_info(payload):
            amount_ks = _parse_amount_ks(payload.get("amt") or payload.get("ttm"))
            receiver = str(payload.get("tto") or payload.get("smn") or "")
            tid = str(payload.get("tid") or "")
            stale = _stale_tx_result(
                _parse_time_ms(payload.get("ts")),
                server_ts,
                trans_id=tid or None,
                amount_ks=amount_ks,
                receiver=receiver,
                qr_raw=qr_raw,
            )
            if stale:
                return stale
            err = self._check_amount(amount_ks, expected_ks)
            if err:
                return VerifyResult("failed", err, trans_id=str(payload.get("tid") or ""), amount_ks=amount_ks, receiver=receiver, qr_raw=qr_raw)
            if not self._match_merchant(receiver):
                return VerifyResult(
                    "failed",
                    f"Receiver mismatch: {receiver or '—'} (expected {self.merchant_name})",
                    trans_id=str(payload.get("tid") or ""),
                    amount_ks=amount_ks,
                    receiver=receiver,
                    qr_raw=qr_raw,
                )
            return VerifyResult(
                "ok",
                "KBZPay receipt verified (public QR)",
                trans_id=tid or None,
                amount_ks=amount_ks,
                receiver=receiver,
                qr_raw=qr_raw,
            )

        tid, dc = tid_and_direction(parsed)
        if tid:
            return self.verify_trans_id(tid, expected_ks, debit_or_credit=dc)
        return VerifyResult("needs_tx_id", "No transaction ID in QR", qr_raw=qr_raw)

    def verify_trans_id(
        self,
        trans_id: str,
        expected_ks: int,
        *,
        debit_or_credit: str = "C",
    ) -> VerifyResult:
        trans_no = re.sub(r"\D", "", trans_id)
        if len(trans_no) < 10:
            return VerifyResult("failed", "Transaction ID too short")

        try:
            detail = self._get_client().fetch_trans_record_detail(
                trans_no=trans_no,
                debit_or_credit=debit_or_credit,
            )
        except Exception as exc:
            msg = str(exc)
            if "AS1002" in msg:
                if debit_or_credit.upper() != "D":
                    return self.verify_trans_id(trans_no, expected_ks, debit_or_credit="D")
                return VerifyResult(
                    "failed",
                    "Transaction not found on merchant KBZ account",
                    trans_id=trans_no,
                )
            return self._api_error_result(exc, trans_id=trans_no)

        amount_ks = _parse_amount_ks(detail.get("displayAmount") or detail.get("amount"))
        status = str(detail.get("tradeStatusDesc") or detail.get("tradeStatus") or "")
        receiver = ""
        for field in detail.get("tradeDetail") or []:
            if not isinstance(field, dict):
                continue
            name = str(field.get("fieldName") or field.get("name") or "").lower()
            value = str(field.get("fieldValue") or field.get("value") or "")
            if "transfer to" in name or "receiver" in name:
                receiver = value

        stale = _stale_tx_result(
            _extract_detail_trade_time_ms(detail),
            self._server_time_ms(),
            trans_id=trans_no,
            amount_ks=amount_ks,
            receiver=receiver,
        )
        if stale:
            return stale

        err = self._check_amount(amount_ks, expected_ks)
        if err:
            return VerifyResult("failed", err, trans_id=trans_no, amount_ks=amount_ks, receiver=receiver)

        if status and "success" not in status.lower() and "complete" not in status.lower():
            return VerifyResult(
                "failed",
                f"Transaction status: {status}",
                trans_id=trans_no,
                amount_ks=amount_ks,
                receiver=receiver,
            )

        # Credit on merchant account = incoming payment
        if debit_or_credit.upper() == "C":
            return VerifyResult(
                "ok",
                "KBZPay verified (merchant account credit)",
                trans_id=trans_no,
                amount_ks=amount_ks,
                receiver=receiver or self.merchant_name,
            )

        if receiver and not self._match_merchant(receiver):
            return VerifyResult(
                "failed",
                f"Receiver mismatch: {receiver}",
                trans_id=trans_no,
                amount_ks=amount_ks,
                receiver=receiver,
            )

        return VerifyResult(
            "ok",
            "KBZPay verified (transaction detail)",
            trans_id=trans_no,
            amount_ks=amount_ks,
            receiver=receiver,
        )

    def verify_receipt_image(self, image_bytes: bytes, expected_ks: int) -> VerifyResult:
        session_err = self._check_session()
        if session_err:
            return session_err
        qr_raw = decode_qr_from_image(image_bytes)
        if not qr_raw:
            return VerifyResult(
                "needs_tx_id",
                "QR code not found on screenshot (old KBZPay app?). Send Transaction ID.",
            )
        return self.verify_qr_string(qr_raw, expected_ks)

    def verify_transaction_id(self, trans_id: str, expected_ks: int) -> VerifyResult:
        session_err = self._check_session()
        if session_err:
            return session_err
        return self.verify_trans_id(trans_id, expected_ks, debit_or_credit="C")


def load_verifier(
    session_path: Path,
    merchant_name: str,
    merchant_phone: str,
) -> KbzPaymentVerifier | None:
    if not session_path.is_file():
        return None
    if not merchant_name and not merchant_phone:
        return None
    return KbzPaymentVerifier(session_path, merchant_name, merchant_phone)
