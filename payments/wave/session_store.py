"""WavePay session file helpers."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from payments.wave.wave_client import WaveClient, WaveSession, load_session, save_session

logger = logging.getLogger(__name__)


def read_session_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def write_session_atomic(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        raise RuntimeError(
            f"Cannot create session directory {path.parent}: permission denied. "
            "On the VPS host run: sudo chown -R 1000:1000 /data/wave && sudo chmod 775 /data/wave"
        ) from exc
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        tmp.replace(path)
    except PermissionError as exc:
        raise RuntimeError(
            f"Cannot write {path}: permission denied. "
            "On the VPS host run: sudo chown -R 1000:1000 /data/wave && sudo chmod 775 /data/wave"
        ) from exc


def clear_session_token(path: Path) -> None:
    data = read_session_file(path) or {}
    data["wmt_mfs"] = ""
    data["_loggedOut"] = True
    write_session_atomic(path, data)


def probe_session(
    path: Path,
    *,
    proxy: str | None = None,
    verify_ssl: bool = True,
) -> tuple[bool, str]:
    """Return (ok, error). ok means wallet-balance succeeded."""
    session = load_session(path)
    if not session:
        return False, "No session file"
    if not session.wmt_mfs:
        return False, "No wmt_mfs token"
    if not session.device.deviceid or not session.device.fingerprint:
        return False, "Missing deviceid/fingerprint"
    try:
        client = WaveClient(session, timeout=20.0, proxy=proxy, verify_ssl=verify_ssl)
        client.wallet_balance()
        save_session(path, client.session)
        return True, ""
    except Exception as exc:
        logger.warning("Wave probe failed: %s", exc)
        return False, str(exc)


def client_from_path(
    path: Path,
    *,
    timeout: float = 30.0,
    proxy: str | None = None,
    verify_ssl: bool = True,
    require_token: bool = True,
) -> WaveClient:
    session = load_session(path)
    if not session:
        raise RuntimeError("Wave session file missing or invalid")
    if not session.device.deviceid or not session.device.fingerprint:
        raise RuntimeError("Wave session needs device.deviceid and device.fingerprint")
    if require_token and not session.wmt_mfs:
        raise RuntimeError("Wave session has no wmt_mfs — login first")
    return WaveClient(session, timeout=timeout, proxy=proxy, verify_ssl=verify_ssl)


def empty_shell(
    *,
    deviceid: str = "",
    fingerprint: str = "",
    msisdn: str = "",
) -> dict[str, Any]:
    sess = WaveSession(
        msisdn=msisdn,
        wmt_mfs="",
    )
    if deviceid:
        sess.device.deviceid = deviceid
    if fingerprint:
        sess.device.fingerprint = fingerprint
    return sess.to_dict()
