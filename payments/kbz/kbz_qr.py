"""KBZ Pay receipt QR decode + public verification (bill H5 page parity)."""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

_BILL_URL_RE = re.compile(
    r"https://static\.kbzpay\.com/app/prod/payment/#/bill\?qrCode=[^\s\"\\]+"
)


@dataclass(frozen=True)
class PublicQrVerifyResult:
    valid: bool
    reason: str
    payload: dict[str, Any]
    source: str  # kprsc | bill | json
    server_time_ms: int
    expires_ms: int | None


def decode_kprsc_payload(kprsc: str) -> dict[str, Any] | None:
    text = kprsc.strip()
    if not text.startswith("KPRSC."):
        return None
    parts = text.split(".", 2)
    if len(parts) < 2:
        return None
    pad = "=" * (-len(parts[1]) % 4)
    try:
        raw = base64.urlsafe_b64decode(parts[1] + pad)
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


def decode_bill_qrcode_param(qr_b64: str) -> dict[str, Any] | None:
    pad = "=" * (-len(qr_b64.strip()) % 4)
    try:
        raw = base64.b64decode(qr_b64.strip() + pad)
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


def parse_qr_input(raw: str) -> dict[str, Any]:
    """Parse KPRSC, bill URL, base64 bill blob, or JSON."""
    text = raw.strip()
    out: dict[str, Any] = {
        "raw": text,
        "kprsc": None,
        "bill": None,
        "json": None,
        "server_time_ms": None,
        "qr_b64": None,
    }

    if text.startswith("KPRSC."):
        out["kprsc"] = decode_kprsc_payload(text)
        return out

    if "qrCode=" in text:
        parsed = urlparse(text)
        fragment = parsed.fragment or ""
        query = fragment.split("?", 1)[-1] if "?" in fragment else parsed.query
        params = parse_qs(query)
        qr_vals = params.get("qrCode") or []
        if qr_vals:
            out["qr_b64"] = unquote(qr_vals[0])
            out["bill"] = decode_bill_qrcode_param(out["qr_b64"])
        st_vals = params.get("serverTime") or []
        if st_vals and str(st_vals[0]).isdigit():
            out["server_time_ms"] = int(st_vals[0])
        return out

    if text.startswith("{"):
        try:
            obj = json.loads(text)
            if isinstance(obj, dict):
                out["json"] = obj
                if obj.get("tid"):
                    out["bill"] = obj
        except json.JSONDecodeError:
            pass
        return out

    if text.startswith("eyJ"):
        out["qr_b64"] = text
        out["bill"] = decode_bill_qrcode_param(text)
        return out

    return out


def _payload_and_source(parsed: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Prefer enriched bill payload over sparse KPRSC when both are present."""
    for key in ("bill", "json"):
        data = parsed.get(key)
        if isinstance(data, dict) and data and has_full_public_payment_info(data):
            return data, key
    if parsed.get("kprsc"):
        return parsed["kprsc"], "kprsc"
    for key in ("bill", "json"):
        data = parsed.get(key)
        if isinstance(data, dict) and data:
            return data, key
    return {}, ""


def verify_public_qr(
    parsed: dict[str, Any],
    *,
    server_time_ms: int | None = None,
) -> PublicQrVerifyResult:
    """
    Same rules as static.kbzpay.com/app/prod/payment/#/bill:
      - decode qrCode JSON
      - reject if serverTime > exp
    """
    payload, source = _payload_and_source(parsed)
    if not payload:
        return PublicQrVerifyResult(
            valid=False,
            reason="Could not decode QR payload",
            payload={},
            source="",
            server_time_ms=server_time_ms or int(time.time() * 1000),
            expires_ms=None,
        )

    exp_raw = payload.get("exp")
    expires_ms: int | None = None
    if exp_raw is not None and str(exp_raw).isdigit():
        expires_ms = int(exp_raw)

    now_ms = server_time_ms or parsed.get("server_time_ms") or int(time.time() * 1000)

    if expires_ms is None:
        return PublicQrVerifyResult(
            valid=False,
            reason="QR payload missing exp",
            payload=payload,
            source=source,
            server_time_ms=now_ms,
            expires_ms=None,
        )

    if now_ms > expires_ms:
        return PublicQrVerifyResult(
            valid=False,
            reason="QR expired (serverTime > exp)",
            payload=payload,
            source=source,
            server_time_ms=now_ms,
            expires_ms=expires_ms,
        )

    return PublicQrVerifyResult(
        valid=True,
        reason="QR valid (same check as KBZ bill page)",
        payload=payload,
        source=source,
        server_time_ms=now_ms,
        expires_ms=expires_ms,
    )


def tid_and_direction(parsed: dict[str, Any]) -> tuple[str | None, str]:
    debit_or_credit = "D"
    payload, _ = _payload_and_source(parsed)
    if not payload:
        return None, debit_or_credit
    if payload.get("tid"):
        if str(payload.get("typ", "D")).upper().startswith("C"):
            debit_or_credit = "C"
        return str(payload["tid"]), debit_or_credit
    return None, debit_or_credit


def has_full_public_payment_info(payload: dict[str, Any]) -> bool:
    """Bill URL qrCode includes parties + amount — no login required."""
    return bool(payload.get("amt") and (payload.get("tto") or payload.get("smn")))


def _find_bill_input_in_text(text: str) -> str | None:
    """Return a bill URL or base64 qrCode blob embedded in arbitrary text."""
    if not text:
        return None
    if "qrCode=" in text and "static.kbzpay.com" in text:
        return text.strip()
    if text.strip().startswith("eyJ") and decode_bill_qrcode_param(text.strip()):
        return text.strip()
    return None


def _walk_for_bill_input(obj: Any) -> str | None:
    if isinstance(obj, str):
        return _find_bill_input_in_text(obj)
    if isinstance(obj, dict):
        for value in obj.values():
            found = _walk_for_bill_input(value)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _walk_for_bill_input(item)
            if found:
                return found
    return None


def extract_scan_execute_from_frida_log(
    qr_input: str,
    log_path: Path,
) -> dict[str, Any] | None:
    """Offline fallback when Mac ScanQRCode2 is blocked — use phone Frida capture."""
    if not log_path.exists():
        return None
    parsed = parse_qr_input(qr_input.strip())
    payload, _ = _payload_and_source(parsed)
    tid = str(payload.get("tid") or "")
    if not tid:
        return None
    for line in reversed(log_path.read_text(encoding="utf-8", errors="replace").splitlines()):
        if "static.kbzpay.com/app/prod/payment/#/bill?qrCode=" not in line:
            continue
        match = _BILL_URL_RE.search(line)
        if not match:
            continue
        bill = parse_qr_input(match.group(0))
        bill_payload, _ = _payload_and_source(bill)
        if str(bill_payload.get("tid")) != tid:
            continue
        if has_full_public_payment_info(bill_payload):
            return {"execute": match.group(0), "TransactionType": "execute", "isNewQR": "1"}
    return None


def extract_bill_input_from_scan(scan_data: dict[str, Any]) -> str | None:
    """ScanQRCode2 (and similar) may return a bill URL or qrCode blob."""
    if not scan_data:
        return None
    for key in (
        "execute",
        "Execute",
        "qrCode",
        "QrCode",
        "BillUrl",
        "JumpUrl",
        "H5Url",
        "WebUrl",
    ):
        value = scan_data.get(key)
        if isinstance(value, str):
            found = _find_bill_input_in_text(value)
            if found:
                return found
    return _walk_for_bill_input(scan_data)


def enrich_parsed_from_scan(
    parsed: dict[str, Any],
    scan_data: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    """Merge ScanQRCode2 bill payload into parsed QR structure."""
    bill_input = extract_bill_input_from_scan(scan_data)
    if not bill_input:
        return parsed, None
    expanded = parse_qr_input(bill_input)
    payload, _ = _payload_and_source(expanded)
    if not has_full_public_payment_info(payload):
        return parsed, bill_input
    merged = dict(parsed)
    merged.update(expanded)
    if parsed.get("kprsc"):
        merged["kprsc"] = parsed["kprsc"]
    return merged, bill_input


BILL_FIELD_LABELS = (
    ("tid", "Transaction No"),
    ("ttp", "Type"),
    ("ttf", "Sender"),
    ("rmn", "Sender Phone"),
    ("smn", "Sender Name"),
    ("tto", "Receiver"),
    ("ttm", "Title Amount"),
    ("amt", "Amount"),
    ("tf", "Fee"),
    ("nt", "Note"),
    ("ts", "Time (ms)"),
    ("exp", "Expires (ms)"),
    ("typ", "Debit/Credit"),
    ("cy", "Currency"),
)
