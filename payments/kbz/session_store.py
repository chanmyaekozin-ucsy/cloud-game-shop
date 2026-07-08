"""Read/update kbz_session.json and refresh token from capture logs."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from payments.kbz.kbz_client import (
    KBZClient,
    extract_latest_token_from_log,
    load_session,
    token_issued_ms,
)
from payments.kbz.verify import _is_token_error

logger = logging.getLogger(__name__)


def read_session_file(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def update_token_in_session_file(path: Path, new_token: str) -> bool:
    """Update token only; preserve deviceProfile and other fields."""
    data = read_session_file(path)
    if not data:
        return False
    old = str(data.get("token") or "")
    if new_token == old:
        return False
    data["token"] = new_token
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return True


def try_refresh_token_from_log(session_path: Path, log_path: Path) -> tuple[bool, str | None]:
    """Pick newest token from Frida/Reqable log and write to session file."""
    if not log_path.is_file():
        return False, None
    new_token = extract_latest_token_from_log(log_path)
    if not new_token:
        return False, None
    data = read_session_file(session_path)
    if not data:
        return False, None
    old_token = str(data.get("token") or "")
    if new_token == old_token:
        return False, None
    old_ms = token_issued_ms(old_token) or 0
    new_ms = token_issued_ms(new_token) or 0
    if new_ms and old_ms and new_ms <= old_ms:
        return False, None
    update_token_in_session_file(session_path, new_token)
    logger.info("KBZ session token updated from log (issued_ms=%s)", new_ms or "?")
    return True, new_token


def extract_token_from_text(text: str) -> str | None:
    """Find newest token in plaintext JSON or log lines."""
    best_ts = -1
    best_token: str | None = None
    pat = re.compile(r'"token"\s*:\s*"([^"]+)"')
    for line in text.splitlines():
        if '"token"' not in line:
            continue
        for match in pat.findall(line):
            issued = token_issued_ms(match)
            if issued is not None and issued > best_ts:
                best_ts = issued
                best_token = match
    if best_token:
        return best_token

    for chunk in re.findall(r"\{[^{}]*\"token\"[^{}]*\}", text, re.DOTALL):
        try:
            obj = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        tok = obj.get("token")
        if tok:
            issued = token_issued_ms(str(tok))
            if issued is not None and issued >= best_ts:
                best_ts = issued
                best_token = str(tok)
    return best_token


def update_token_from_plaintext_capture(session_path: Path, text: str) -> tuple[bool, str | None]:
    token = extract_token_from_text(text)
    if not token:
        return False, None
    if not update_token_in_session_file(session_path, token):
        return False, token
    return True, token


def probe_session(session_path: Path) -> tuple[bool, str]:
    """Return (ok, error_message)."""
    session = load_session(session_path)
    if not session:
        return False, "Session file missing or has no token"
    try:
        KBZClient(session, timeout=20.0).fetch_balance()
        return True, ""
    except Exception as exc:
        msg = str(exc)
        if _is_token_error(msg):
            return False, msg
        logger.warning("KBZ session probe failed: %s", msg)
        return False, msg
