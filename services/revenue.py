"""Admin revenue stats — sales, Smile coin cost (အရင်း), profit (အမြတ်)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from bot import config
from providers.smileone.packages import load_package_lists

MMT = timezone(timedelta(hours=6, minutes=30))


def parse_smile_coin(raw: Any) -> float:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _parse_order_time_mmt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        # SQLite datetime('now') is UTC without timezone suffix
        dt = datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(MMT)


def _catalog_coin_maps() -> tuple[dict[str, float], dict[int, float]]:
    by_goods: dict[str, float] = {}
    by_package_id: dict[int, float] = {}
    for pkg in load_package_lists():
        coin = parse_smile_coin(pkg.get("smile_coin"))
        if coin <= 0:
            continue
        goods = str(pkg.get("smile_goods_id") or "").strip()
        if goods:
            by_goods[goods] = coin
        try:
            by_package_id[int(pkg.get("id"))] = coin
        except (TypeError, ValueError):
            pass
    return by_goods, by_package_id


def resolve_order_smile_coin(
    order: dict[str, Any],
    *,
    by_goods: dict[str, float] | None = None,
    by_package_id: dict[int, float] | None = None,
) -> float:
    """Prefer snapshotted order.smile_coin, else catalog by goods id / package id."""
    snap = parse_smile_coin(order.get("smile_coin"))
    if snap > 0:
        return snap
    if by_goods is None or by_package_id is None:
        by_goods, by_package_id = _catalog_coin_maps()
    goods = str(order.get("smile_goods_id") or "").strip()
    if goods and by_goods.get(goods, 0) > 0:
        return by_goods[goods]
    try:
        pid = int(order.get("package_id") or 0)
    except (TypeError, ValueError):
        pid = 0
    if pid and by_package_id.get(pid, 0) > 0:
        return by_package_id[pid]
    return 0.0


def _empty_bucket() -> dict[str, Any]:
    return {
        "orders": 0,
        "revenue_ks": 0.0,
        "cost_ks": 0.0,
        "profit_ks": 0.0,
        "missing_coin": 0,
    }


def _add_order(bucket: dict[str, Any], *, amount_ks: float, coin: float) -> None:
    rate = float(config.SMILE_COIN_KS_RATE)
    cost = coin * rate
    bucket["orders"] += 1
    bucket["revenue_ks"] += amount_ks
    bucket["cost_ks"] += cost
    bucket["profit_ks"] += amount_ks - cost
    if coin <= 0:
        bucket["missing_coin"] += 1


def compute_revenue(orders: list[dict[str, Any]]) -> dict[str, Any]:
    """Split completed orders into today / week / month / all-time (MMT)."""
    now = datetime.now(MMT)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    month_start = today_start.replace(day=1)

    buckets = {
        "today": _empty_bucket(),
        "week": _empty_bucket(),
        "month": _empty_bucket(),
        "all": _empty_bucket(),
    }
    by_goods, by_package_id = _catalog_coin_maps()

    for order in orders:
        amount = float(order.get("amount_ks") or 0)
        coin = resolve_order_smile_coin(
            order, by_goods=by_goods, by_package_id=by_package_id
        )
        _add_order(buckets["all"], amount_ks=amount, coin=coin)

        when = _parse_order_time_mmt(order.get("created_at"))
        if when is None:
            continue
        if when >= today_start:
            _add_order(buckets["today"], amount_ks=amount, coin=coin)
        if when >= week_start:
            _add_order(buckets["week"], amount_ks=amount, coin=coin)
        if when >= month_start:
            _add_order(buckets["month"], amount_ks=amount, coin=coin)

    return {
        "rate": float(config.SMILE_COIN_KS_RATE),
        "as_of": now,
        "week_start": week_start,
        "month_start": month_start,
        "periods": buckets,
    }


def _fmt_ks(value: float) -> str:
    # Show whole kyats for readability
    return f"{int(round(value)):,} Ks"


def format_revenue_report(stats: dict[str, Any]) -> str:
    as_of: datetime = stats["as_of"]
    rate = stats["rate"]
    periods = stats["periods"]
    labels = (
        ("today", "📅 Today"),
        ("week", "📆 This week"),
        ("month", "🗓 This month"),
        ("all", "♾ All time"),
    )
    lines = [
        "💰 Revenue",
        f"As of {as_of.strftime('%Y-%m-%d %H:%M')} MMT",
        f"အရင်း rate: 1 Smile Coin = {rate:g} Ks",
        "",
    ]
    missing_total = 0
    for key, title in labels:
        b = periods[key]
        if key == "all":
            missing_total = int(b["missing_coin"])
        lines.extend(
            [
                title,
                f"Orders: {b['orders']}",
                f"ရောင်းရငွေ: {_fmt_ks(b['revenue_ks'])}",
                f"အရင်း: {_fmt_ks(b['cost_ks'])}",
                f"အမြတ်: {_fmt_ks(b['profit_ks'])}",
                "",
            ]
        )
    if missing_total:
        lines.append(
            f"⚠️ {missing_total} completed order(s) missing smile_coin "
            "(အရင်း may be low). Run Packages → Auto CSV / Import to fill coins."
        )
    return "\n".join(lines).strip()
