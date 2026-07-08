"""Persist Smile.one browser cookies in a session file."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from providers.smileone.config import SESSION_PATH, ensure_data_dir, region


@dataclass
class SmileSession:
    """On-disk Smile.one session (cookies + metadata)."""

    cookie_header: str
    cookies: list[dict[str, Any]]
    saved_at: str
    region: str
    path: Path = SESSION_PATH

    @classmethod
    def load(cls, path: Path | None = None) -> SmileSession | None:
        session_path = path or SESSION_PATH
        if not session_path.is_file():
            return None
        try:
            data = json.loads(session_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        cookie_header = str(data.get("cookie_header", "")).strip()
        cookies = data.get("cookies")
        if not cookie_header or not isinstance(cookies, list):
            return None
        return cls(
            cookie_header=cookie_header,
            cookies=cookies,
            saved_at=str(data.get("saved_at", "")),
            region=str(data.get("region", region())),
            path=session_path,
        )

    @classmethod
    def from_playwright_cookies(
        cls,
        cookies: list[dict[str, Any]],
        *,
        session_region: str | None = None,
        path: Path | None = None,
    ) -> SmileSession:
        header = cookies_to_header(cookies)
        now = datetime.now(timezone.utc).isoformat()
        session = cls(
            cookie_header=header,
            cookies=cookies,
            saved_at=now,
            region=session_region or region(),
            path=path or SESSION_PATH,
        )
        session.save()
        return session

    def save(self) -> None:
        ensure_data_dir()
        payload = {
            "cookie_header": self.cookie_header,
            "cookies": self.cookies,
            "saved_at": self.saved_at,
            "region": self.region,
        }
        self.path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def has_phpsessid(self) -> bool:
        return "PHPSESSID=" in self.cookie_header

    def phpsessid(self) -> str | None:
        for part in self.cookie_header.split(";"):
            part = part.strip()
            if part.startswith("PHPSESSID="):
                return part.split("=", 1)[1]
        return None


def cookies_to_header(cookies: list[dict[str, Any]]) -> str:
    """Build a Cookie request header from Playwright cookie dicts."""
    pairs: list[str] = []
    seen: set[str] = set()
    for c in cookies:
        name = str(c.get("name", "")).strip()
        if not name or name in seen:
            continue
        value = str(c.get("value", ""))
        pairs.append(f"{name}={value}")
        seen.add(name)
    return "; ".join(pairs)


def filter_smile_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep cookies relevant to smile.one."""
    out: list[dict[str, Any]] = []
    for c in cookies:
        domain = str(c.get("domain", ""))
        if "smile.one" in domain or domain == "":
            out.append(c)
    return out
