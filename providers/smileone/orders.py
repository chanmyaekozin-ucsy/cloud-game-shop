"""Smile.one order history API."""

from __future__ import annotations

import os
import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from providers.smileone.config import order_url

DEFAULT_ORDERLIST_PAGE_SIZE = 10
TZ_SMILE_ORDER_DISPLAY = ZoneInfo("America/Sao_Paulo")
TZ_MMT = ZoneInfo("Asia/Yangon")

_GAME_DISPLAY_NAMES: dict[str, str] = {
    "mobilelegends": "Mobile Legends",
    "pubgmobilebr": "PUBG Mobile BR",
}


@dataclass
class OrderRecord:
    package_name: str
    game: str
    date_mmt: str
    price: str
    game_id: str
    zone_id: str


@dataclass
class OrderHistoryPage:
    orders: list[OrderRecord]
    page: int
    total_pages: int
    total_count: int


def codelist_url_from_order_page(order_page_url: str) -> str:
    ou = order_page_url.rstrip("/")
    suffix = "/customer/order"
    if ou.endswith(suffix):
        return ou[: -len(suffix)] + "/customer/activationcode/codelist"
    return "https://www.smile.one/br/customer/activationcode/codelist"


def build_orderlist_url(
    order_page_url: str,
    *,
    startdate: str,
    enddate: str,
    page: int = 1,
    page_size: int | None = None,
) -> str:
    if page_size is None:
        page_size = int(
            os.environ.get("SMILE_ORDERLIST_PAGE_SIZE", str(DEFAULT_ORDERLIST_PAGE_SIZE))
        )
    base = codelist_url_from_order_page(order_page_url)
    q = urllib.parse.urlencode(
        {
            "type": "orderlist",
            "p": str(page),
            "pageSize": str(page_size),
            "status": "",
            "startdate": startdate,
            "enddate": enddate,
            "key": "",
            "user_id": "",
        }
    )
    return f"{base}?{q}"


def parse_yyyy_mm_dd(line: str) -> str | None:
    s = line.strip()
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def updated_at_to_mmt(updated_at: str) -> str:
    raw = (updated_at or "").strip()
    if not raw:
        return ""
    try:
        dt_local = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return f"{raw} (unparsed)"
    dt_local = dt_local.replace(tzinfo=TZ_SMILE_ORDER_DISPLAY)
    return dt_local.astimezone(TZ_MMT).strftime("%Y-%m-%d %H:%M:%S") + " MMT"


def format_order_price(amount: object, currency: object) -> str:
    try:
        return f"{float(amount):.2f} {currency}"
    except (TypeError, ValueError):
        return f"{amount} {currency}"


def game_display_name(game_id: object) -> str:
    raw = str(game_id or "").strip().lower()
    if not raw:
        return ""
    if raw in _GAME_DISPLAY_NAMES:
        return _GAME_DISPLAY_NAMES[raw]
    return raw.replace("_", " ").title()


def total_pages_for(count: int, page_size: int) -> int:
    if count <= 0:
        return 1
    return max(1, (count + page_size - 1) // page_size)


def parse_order_history(data: dict, *, page: int, page_size: int) -> OrderHistoryPage:
    rows = data.get("list")
    if not isinstance(rows, list):
        raise ValueError("Unexpected response: missing list.")

    try:
        count = int(data.get("count", 0))
    except (TypeError, ValueError):
        count = 0

    orders: list[OrderRecord] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        orders.append(
            OrderRecord(
                package_name=str(row.get("goods_name", "")).strip(),
                game=game_display_name(row.get("game_id")),
                date_mmt=updated_at_to_mmt(str(row.get("updated_at", ""))),
                price=format_order_price(row.get("grand_total"), row.get("total_fee_currency")),
                game_id=str(row.get("user_id", "")),
                zone_id=str(row.get("server_id", "") or "").strip(),
            )
        )

    return OrderHistoryPage(
        orders=orders,
        page=page,
        total_pages=total_pages_for(count, page_size),
        total_count=count,
    )
