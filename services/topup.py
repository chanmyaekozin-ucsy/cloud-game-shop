"""Place Smile.one MLBB orders via merchant pay."""

from __future__ import annotations

import logging

from providers.smileone.auth import SmileAuthError
from providers.smileone.client import SmileOneClient

logger = logging.getLogger("cloud_gameshop.topup")


def place_mlbb_order(
    *,
    smile_goods_id: str,
    game_id: str,
    server_id: str,
    package_name: str,
) -> str:
    """Top up MLBB via Smile.one merchant pay. Returns an admin-only note."""
    client = SmileOneClient(auto_relogin=True)
    try:
        balance = client.get_balance()
    except SmileAuthError as e:
        raise SmileAuthError(f"Smile.one session error: {e}") from e

    logger.info(
        "Top-up start: goods=%s game=%s server=%s plan=%s balance=%s",
        smile_goods_id,
        game_id,
        server_id,
        package_name,
        balance,
    )
    note = client.pay_mlbb(
        game_id=game_id,
        server_id=server_id,
        goods_id=smile_goods_id,
    )
    logger.info(
        "Top-up done: goods=%s game=%s server=%s plan=%s",
        smile_goods_id,
        game_id,
        server_id,
        package_name,
    )
    return note
