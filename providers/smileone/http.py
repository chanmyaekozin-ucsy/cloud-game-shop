"""Low-level HTTP helpers for Smile.one (no session management)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from providers.smileone.config import USER_AGENT

_BALANCE_RE = re.compile(
    r'<div class="user-balance-section"[^>]*>.*?'
    r'<div class="balance-coins">\s*'
    r"<p>[^<]*</p>\s*"
    r"<p>([^<]+)</p>",
    re.IGNORECASE | re.DOTALL,
)


_LOGIN_PATH = "/customer/account/login"
_LOGIN_TITLE_RE = re.compile(
    r"<title>[^<]*(login|entrar|sign\s*in)[^<]*</title>",
    re.IGNORECASE,
)


def looks_like_login_page(html: str, *, final_url: str | None = None) -> bool:
    """Detect Smile.one login page from HTML and/or redirect URL."""
    if "balance-coins" in html:
        return False
    # Logged-in MLBB merchant page still shows guest login links in the header.
    if "info = JSON.parse" in html:
        return False
    if final_url and _LOGIN_PATH in final_url:
        return True
    if "customer/account/login" in html:
        return True
    if _LOGIN_TITLE_RE.search(html):
        return True
    if "Login with Google" in html or "Entrar com Google" in html:
        return True
    return False


def fetch_html(
    url: str,
    cookie: str,
    timeout_sec: int,
    *,
    referer: str | None = None,
) -> tuple[str, str]:
    headers: dict[str, str] = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookie,
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        body = resp.read().decode(charset, errors="replace")
        final_url = resp.geturl()
    return body, final_url


def fetch_json(
    url: str,
    cookie: str,
    timeout_sec: int,
    *,
    referer: str,
) -> tuple[Any | None, str | None]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": cookie,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            raw = resp.read().decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        msg = f"HTTP {e.code}: {e.reason}"
        if e.code == 403:
            msg += ". Cloudflare may block scripted requests — refresh session via browser login."
        return None, msg
    except urllib.error.URLError as e:
        return None, f"Request failed: {e}"

    try:
        return json.loads(raw), None
    except json.JSONDecodeError:
        if looks_like_login_page(raw):
            return None, "session_expired"
        return None, "Response was not JSON."


def parse_balance(html: str) -> str | None:
    m = _BALANCE_RE.search(html)
    return m.group(1).strip() if m else None


_CSRF_RE = re.compile(r"""name=["']_csrf["']\s+value=["']([^"']+)["']""", re.IGNORECASE)


def extract_csrf(html: str) -> str | None:
    m = _CSRF_RE.search(html)
    return m.group(1).strip() if m else None


def _request_headers(
    cookie: str,
    *,
    referer: str | None = None,
    accept: str,
    content_type: str | None = None,
    xhr: bool = False,
) -> dict[str, str]:
    headers: dict[str, str] = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookie,
    }
    if referer:
        headers["Referer"] = referer
    if content_type:
        headers["Content-Type"] = content_type
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
    return headers


def post_json(
    url: str,
    cookie: str,
    data: dict[str, str],
    timeout_sec: int,
    *,
    referer: str,
) -> tuple[dict[str, Any] | None, str | None]:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers=_request_headers(
            cookie,
            referer=referer,
            accept="application/json, text/javascript, */*; q=0.01",
            content_type="application/x-www-form-urlencoded",
            xhr=True,
        ),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            raw = resp.read().decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        msg = f"HTTP {e.code}: {e.reason}"
        if e.code == 403:
            msg += ". Cloudflare may block scripted requests — refresh session via browser login."
        return None, msg
    except urllib.error.URLError as e:
        return None, f"Request failed: {e}"

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        if looks_like_login_page(raw):
            return None, "session_expired"
        return None, "Response was not JSON."
    return (parsed, None) if isinstance(parsed, dict) else (None, "Unexpected JSON shape.")


def post_form(
    url: str,
    cookie: str,
    data: dict[str, str],
    timeout_sec: int,
    *,
    referer: str,
    origin: str = "https://www.smile.one",
) -> tuple[str, str]:
    body = urllib.parse.urlencode(data).encode()
    headers = _request_headers(
        cookie,
        referer=referer,
        accept="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        content_type="application/x-www-form-urlencoded",
    )
    headers["Origin"] = origin
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        html = resp.read().decode(charset, errors="replace")
        return html, resp.geturl()


def session_is_valid(cookie_header: str, check_url: str, timeout_sec: int = 20) -> bool:
    try:
        html, final_url = fetch_html(check_url, cookie_header, timeout_sec)
    except Exception:
        return False
    if looks_like_login_page(html, final_url=final_url):
        return False
    return True
