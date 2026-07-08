"""SQLite storage for orders and payments."""

from __future__ import annotations

import aiosqlite

from bot import config
from bot import i18n

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    language TEXT DEFAULT 'my',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    package_id INTEGER,
    package_name TEXT NOT NULL,
    amount_ks INTEGER NOT NULL,
    smile_goods_id TEXT,
    game_id TEXT,
    server_id TEXT,
    nickname TEXT,
    region TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    kbz_trans_id TEXT,
    verify_status TEXT,
    verify_message TEXT,
    proof_message_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_kbz_trans
    ON orders(kbz_trans_id) WHERE kbz_trans_id IS NOT NULL;
"""


async def init_db() -> None:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def upsert_user(
    telegram_id: int,
    *,
    username: str | None,
    first_name: str | None,
) -> dict:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO users (telegram_id, username, first_name, language)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = excluded.username,
                first_name = excluded.first_name
            """,
            (telegram_id, username, first_name, i18n.DEFAULT_LANG),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT * FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        row = await cur.fetchone()
        return dict(row)


async def set_user_language(telegram_id: int, language: str) -> dict:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "UPDATE users SET language = ? WHERE telegram_id = ?",
            (language, telegram_id),
        )
        await db.commit()
        cur = await db.execute(
            "SELECT * FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        row = await cur.fetchone()
        if row:
            return dict(row)
        cur = await db.execute(
            """
            INSERT INTO users (telegram_id, language)
            VALUES (?, ?)
            """,
            (telegram_id, language),
        )
        await db.commit()
        cur2 = await db.execute(
            "SELECT * FROM users WHERE telegram_id = ?",
            (telegram_id,),
        )
        return dict(await cur2.fetchone())


async def create_order(
    user_id: int,
    *,
    package_id: int,
    package_name: str,
    amount_ks: int,
    smile_goods_id: str,
    game_id: str,
    server_id: str,
    nickname: str,
    region: str,
) -> dict:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            INSERT INTO orders (
                user_id, package_id, package_name, amount_ks, smile_goods_id,
                game_id, server_id, nickname, region, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment')
            """,
            (
                user_id,
                package_id,
                package_name,
                amount_ks,
                smile_goods_id,
                game_id,
                server_id,
                nickname,
                region,
            ),
        )
        await db.commit()
        oid = cur.lastrowid
        cur2 = await db.execute("SELECT * FROM orders WHERE id = ?", (oid,))
        return dict(await cur2.fetchone())


async def get_open_order_for_user(user_id: int) -> dict | None:
    """Latest order still waiting for payment or being processed."""
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM orders
            WHERE user_id = ?
              AND status IN ('awaiting_payment', 'processing')
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_order(order_id: int) -> dict | None:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def update_order(order_id: int, **fields: object) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [order_id]
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        await db.execute(f"UPDATE orders SET {cols} WHERE id = ?", vals)
        await db.commit()


async def claim_kbz_trans(trans_id: str, order_id: int) -> bool:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        try:
            await db.execute(
                "UPDATE orders SET kbz_trans_id = ? WHERE id = ? AND kbz_trans_id IS NULL",
                (trans_id, order_id),
            )
            await db.commit()
            cur = await db.execute(
                "SELECT id FROM orders WHERE kbz_trans_id = ?",
                (trans_id,),
            )
            row = await cur.fetchone()
            return row is not None and int(row[0]) == order_id
        except aiosqlite.IntegrityError:
            return False


async def list_user_orders(user_id: int, *, limit: int = 10) -> list[dict]:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT * FROM orders WHERE user_id = ?
            ORDER BY id DESC LIMIT ?
            """,
            (user_id, limit),
        )
        return [dict(r) for r in await cur.fetchall()]


async def count_users() -> int:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM users")
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def list_users(*, limit: int = 25, offset: int = 0) -> list[dict]:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """
            SELECT
                u.*,
                COUNT(o.id) AS order_count
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY u.id
            ORDER BY u.id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        return [dict(r) for r in await cur.fetchall()]


async def list_user_telegram_ids() -> list[int]:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        cur = await db.execute(
            "SELECT telegram_id FROM users ORDER BY id ASC"
        )
        rows = await cur.fetchall()
        return [int(r[0]) for r in rows if r and r[0] is not None]
