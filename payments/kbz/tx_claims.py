"""Shared cross-bot ledger of used KBZ transaction IDs.

AirVPN and Cloud Game Shop (and any other shop) must use the same file on a
shared volume (next to kbz_session.json) so one transfer cannot buy twice.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def _normalize_tx(trans_id: str) -> str:
    return re.sub(r"\D", "", (trans_id or "").strip())


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS claimed_txs (
            trans_id TEXT PRIMARY KEY,
            bot TEXT NOT NULL,
            ref_id TEXT NOT NULL,
            claimed_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def try_claim_tx(
    path: Path | str,
    trans_id: str,
    *,
    bot: str,
    ref_id: str,
) -> bool:
    """Atomically claim a full KBZ transaction ID for this bot+ref.

    Returns True if this caller owns the claim (new or same bot+ref).
    Returns False if another bot/ref already claimed it.
    """
    tid = _normalize_tx(trans_id)
    if not tid:
        return False
    bot = (bot or "").strip() or "unknown"
    ref_id = str(ref_id).strip()
    if not ref_id:
        return False

    db_path = Path(path)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = _connect(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT bot, ref_id FROM claimed_txs WHERE trans_id = ?",
            (tid,),
        ).fetchone()
        if row:
            same = row["bot"] == bot and row["ref_id"] == ref_id
            conn.commit()
            return same
        conn.execute(
            """
            INSERT INTO claimed_txs (trans_id, bot, ref_id, claimed_at)
            VALUES (?, ?, ?, ?)
            """,
            (tid, bot, ref_id, now),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        conn.rollback()
        row = conn.execute(
            "SELECT bot, ref_id FROM claimed_txs WHERE trans_id = ?",
            (tid,),
        ).fetchone()
        return bool(row and row["bot"] == bot and row["ref_id"] == ref_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def release_tx(
    path: Path | str,
    trans_id: str,
    *,
    bot: str,
    ref_id: str,
) -> None:
    """Drop a claim created by this bot+ref (e.g. local DB claim failed after)."""
    tid = _normalize_tx(trans_id)
    if not tid:
        return
    conn = _connect(Path(path))
    try:
        conn.execute(
            """
            DELETE FROM claimed_txs
            WHERE trans_id = ? AND bot = ? AND ref_id = ?
            """,
            (tid, bot, str(ref_id)),
        )
        conn.commit()
    finally:
        conn.close()


def is_tx_claimed(path: Path | str, trans_id: str) -> bool:
    tid = _normalize_tx(trans_id)
    if not tid:
        return False
    conn = _connect(Path(path))
    try:
        row = conn.execute(
            "SELECT 1 FROM claimed_txs WHERE trans_id = ? LIMIT 1",
            (tid,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()
