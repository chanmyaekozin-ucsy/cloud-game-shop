"""Own package catalog (MMK prices mapped to Smile.one goods IDs)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from providers.smileone.config import PROJECT_ROOT, ensure_data_dir

DEFAULT_PACKAGE_LISTS_PATH = PROJECT_ROOT / "data" / "package_lists.json"


def package_lists_path() -> Path:
    raw = os.environ.get("SMILE_PACKAGE_LISTS_JSON", "").strip()
    return Path(raw) if raw else DEFAULT_PACKAGE_LISTS_PATH


def load_package_lists() -> list[dict[str, Any]]:
    path = package_lists_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        inner = data.get("packages")
        if isinstance(inner, list):
            return [x for x in inner if isinstance(x, dict)]
    return []


def save_package_lists(records: list[dict[str, Any]]) -> Path:
    ensure_data_dir()
    path = package_lists_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def index_by_goods_id(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in records:
        gid = str(r.get("smile_goods_id", "")).strip()
        if gid:
            out[gid] = r
    return out


def next_id(records: list[dict[str, Any]]) -> int:
    m = 0
    for r in records:
        try:
            m = max(m, int(r.get("id", 0)))
        except (TypeError, ValueError):
            continue
    return m + 1


def normalize_price_mmk(raw: str) -> str:
    r = raw.strip()
    if not r:
        return ""
    if r.upper().rstrip().endswith("MMK"):
        return r
    return f"{r} MMK"
