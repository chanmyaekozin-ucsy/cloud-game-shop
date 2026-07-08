"""Package catalog CSV export/import for admin workflow."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from providers.smileone.mlbb import MlbbPackage
from providers.smileone.packages import normalize_price_mmk

CSV_FIELDS = (
    "id",
    "package_name",
    "original_package_name",
    "price_mmk",
    "smile_coin",
    "smile_goods_id",
    "brl",
    "note",
)


def round_mmk_price(coin: float, multiplier: float) -> int:
    """coin × multiplier, rounded to nearest 100 MMK (e.g. 3510 → 3500)."""
    raw = coin * multiplier
    return int(round(raw / 100) * 100)


def _short_package_name(full_name: str) -> str:
    text = re.sub(r"\s+", " ", full_name.replace("\n", " ")).strip()
    if "(" in text:
        text = text.split("(", 1)[0].strip()
    return text[:80] if len(text) > 80 else text


def build_auto_rows(packages: list[MlbbPackage], multiplier: float) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index, pkg in enumerate(packages, start=1):
        try:
            coin = float(str(pkg.smile_coin).replace(",", ""))
        except ValueError:
            coin = 0.0
        mmk = round_mmk_price(coin, multiplier)
        full_name = re.sub(r"\s+", " ", pkg.name.replace("\n", " ")).strip()
        rows.append(
            {
                "id": str(index),
                "package_name": _short_package_name(pkg.name),
                "original_package_name": full_name,
                "price_mmk": str(mmk),
                "smile_coin": str(pkg.smile_coin),
                "smile_goods_id": str(pkg.goods_id),
                "brl": str(pkg.brl),
                "note": "",
            }
        )
    return rows


def rows_to_csv_bytes(rows: list[dict[str, str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k, "") for k in CSV_FIELDS})
    return buf.getvalue().encode("utf-8-sig")


def _parse_price_mmk(raw: str) -> int:
    text = str(raw or "").strip()
    text = re.sub(r"(?i)\s*mmk\s*$", "", text)
    text = text.replace(",", "").strip()
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def csv_to_package_records(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    errors: list[str] = []
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], ["CSV must be UTF-8 encoded"]

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["CSV has no header row"]

    rows = list(reader)
    if not rows:
        return [], ["CSV has no data rows"]

    records: list[dict[str, Any]] = []
    next_auto_id = 1

    for line_no, row in enumerate(rows, start=2):
        goods_id = str(row.get("smile_goods_id") or "").strip()
        if not goods_id:
            errors.append(f"Row {line_no}: missing smile_goods_id")
            continue

        price_mmk = _parse_price_mmk(
            str(row.get("price_mmk") or row.get("price") or "").strip()
        )
        if price_mmk <= 0:
            errors.append(f"Row {line_no}: invalid price_mmk")
            continue

        package_name = str(row.get("package_name") or "").strip()
        if not package_name:
            package_name = _short_package_name(
                str(row.get("original_package_name") or f"Package {goods_id}")
            )

        raw_id = str(row.get("id") or "").strip()
        if raw_id.isdigit():
            pkg_id = int(raw_id)
        else:
            pkg_id = next_auto_id
        next_auto_id = max(next_auto_id, pkg_id + 1)

        records.append(
            {
                "id": pkg_id,
                "package_name": package_name,
                "original_package_name": str(
                    row.get("original_package_name") or package_name
                ).strip(),
                "price": normalize_price_mmk(str(price_mmk)),
                "smile_coin": str(row.get("smile_coin") or "").strip(),
                "smile_goods_id": goods_id,
                "note": str(row.get("note") or "").strip(),
            }
        )

    if not records:
        return [], errors or ["No valid package rows found"]

    records.sort(key=lambda r: int(r["id"]))
    seen_ids: set[int] = set()
    for rec in records:
        pid = int(rec["id"])
        while pid in seen_ids:
            pid += 1
        seen_ids.add(pid)
        rec["id"] = pid

    return records, errors
