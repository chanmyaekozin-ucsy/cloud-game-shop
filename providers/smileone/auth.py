"""Fully automated Smile.one session refresh via headless browser."""

from __future__ import annotations

import re
import sys
import time
from typing import Any

from providers.smileone.config import (
    BROWSER_PROFILE_DIR,
    browser_channel,
    ensure_data_dir,
    headless,
    login_url,
    login_wait_seconds,
    mark_profile_ready,
    order_url,
    profile_is_ready,
    refresh_headless,
    region,
)
from providers.smileone.http import parse_balance, session_is_valid
from providers.smileone.session import (
    SmileSession,
    cookies_to_header,
    filter_smile_cookies,
)


class SmileAuthError(RuntimeError):
    """Login or session refresh failed."""


_GOOGLE_BUTTON_RE = re.compile(r"google", re.IGNORECASE)
_LOGIN_PATH = "/customer/account/login"
_LOGIN_TITLE_RE = re.compile(
    r"<title>[^<]*(login|entrar|sign\s*in)[^<]*</title>",
    re.IGNORECASE,
)
_GOOGLE_CONTINUE_RE = re.compile(
    r"^(continue|continuar|next|siguiente|allow|yes|ok|confirm)$",
    re.IGNORECASE,
)


def login_with_google(*, force: bool = False) -> SmileSession:
    """
    Refresh Smile.one session fully automatically (headless by default).

    Requires a one-time browser profile setup (Google account saved in
  `.data/browser_profile/`). After that, refresh needs no manual clicks.
    """
    existing = SmileSession.load()
    if existing and existing.has_phpsessid() and not force:
        if session_is_valid(existing.cookie_header, order_url()):
            return existing

    if not profile_is_ready():
        raise SmileAuthError(
            "Browser profile not set up for unattended login.\n"
            "Run once (visible browser, sign in with Google):\n"
            "  SMILE_HEADLESS=false .venv/bin/python3 scripts/smileone_setup.py"
        )

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise SmileAuthError(
            "Playwright is not installed. Run:\n"
            "  pip install -r requirements.txt\n"
            "  playwright install chromium"
        ) from e

    ensure_data_dir()
    BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    target_order = order_url()
    cookies: list[dict[str, Any]]

    with sync_playwright() as p:
        context = _launch_context(p, headless_mode=refresh_headless())
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(60_000)

        try:
            print("Auto-refresh: syncing cookies from browser profile…", file=sys.stderr)
            saved = _try_order_page_session(context, page)
            if saved:
                return saved

            print("Auto-refresh: Google OAuth (automated, no manual clicks)…", file=sys.stderr)
            page.goto(login_url(), wait_until="domcontentloaded")
            if _LOGIN_PATH in page.url or _page_looks_like_login(page):
                _click_google_login(page, context)

            _wait_for_smile_login(context, page)

            try:
                page.goto(target_order, wait_until="domcontentloaded", timeout=30_000)
            except Exception:
                pass

            saved = _extract_valid_session(context)
            if saved:
                return saved

            cookies = filter_smile_cookies(context.cookies())
            if not _has_phpsessid(cookies):
                raise SmileAuthError(
                    "Automated login finished but PHPSESSID is missing. "
                    "Run one-time setup: python scripts/smileone_setup.py"
                )
        finally:
            context.close()
            time.sleep(1)

    session = SmileSession.from_playwright_cookies(cookies, session_region=region())
    if not session_is_valid(session.cookie_header, target_order):
        raise SmileAuthError(
            "Automated login saved cookies but Smile.one still rejects the session. "
            "Re-run setup: SMILE_HEADLESS=false python scripts/smileone_setup.py"
        )
    return session


def refresh_session() -> SmileSession:
    """Force automated browser refresh and overwrite session.json."""
    return login_with_google(force=True)


def setup_browser_profile() -> SmileSession:
    """
    One-time visible browser login. Saves Google + Smile.one into the profile.
    After this, all refreshes are headless and fully automatic.
    """
    import os

    os.environ["SMILE_HEADLESS"] = "false"
    ensure_data_dir()
    BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise SmileAuthError(
            "Playwright is not installed. Run:\n"
            "  pip install -r requirements.txt\n"
            "  playwright install chromium"
        ) from e

    target_order = order_url()
    cookies: list[dict[str, Any]]

    with sync_playwright() as p:
        context = _launch_context(p, headless_mode=False)
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(120_000)

        try:
            print("Setup: open Smile.one and sign in with Google in the browser…", file=sys.stderr)
            page.goto(login_url(), wait_until="domcontentloaded")
            _click_google_login(page, context)
            _wait_for_smile_login(context, page, wait_seconds=600)

            try:
                page.goto(target_order, wait_until="domcontentloaded", timeout=60_000)
            except Exception:
                pass

            cookies = filter_smile_cookies(context.cookies())
            if not _has_phpsessid(cookies):
                raise SmileAuthError("Setup incomplete — PHPSESSID not found after login.")
        finally:
            context.close()

    session = SmileSession.from_playwright_cookies(cookies, session_region=region())
    if not session_is_valid(session.cookie_header, target_order):
        raise SmileAuthError("Setup incomplete — session not valid after login.")

    mark_profile_ready()
    print("Setup complete. Future refreshes are fully automatic (headless).", file=sys.stderr)
    return session


def _launch_context(p: Any, *, headless_mode: bool) -> Any:
    args = ["--disable-blink-features=AutomationControlled"]
    if not headless_mode:
        # Off-screen window — automated, no user interaction.
        args.append("--window-position=-32000,-32000")
    kwargs: dict[str, Any] = {
        "user_data_dir": str(BROWSER_PROFILE_DIR),
        "headless": headless_mode,
        "viewport": {"width": 1280, "height": 800},
        "locale": "en-US",
        "args": args,
    }
    channel = browser_channel()
    if channel:
        try:
            return p.chromium.launch_persistent_context(channel=channel, **kwargs)
        except Exception:
            pass
    return p.chromium.launch_persistent_context(**kwargs)


def _has_phpsessid(cookies: list[dict[str, Any]]) -> bool:
    return any(c.get("name") == "PHPSESSID" for c in cookies)


def _try_save_session_from_context(context: Any, page: Any) -> SmileSession | None:
    try:
        page.goto(order_url(), wait_until="domcontentloaded", timeout=30_000)
    except Exception:
        pass
    return _extract_valid_session(context)


def _try_order_page_session(context: Any, page: Any) -> SmileSession | None:
    try:
        page.goto(order_url(), wait_until="domcontentloaded", timeout=45_000)
    except Exception:
        pass
    if _LOGIN_PATH in page.url or _page_looks_like_login(page):
        return None
    cookies = filter_smile_cookies(context.cookies())
    if not _has_phpsessid(cookies):
        return None
    try:
        if parse_balance(page.content()):
            return SmileSession.from_playwright_cookies(cookies, session_region=region())
    except Exception:
        pass
    return _extract_valid_session(context)


def _extract_valid_session(context: Any) -> SmileSession | None:
    cookies = filter_smile_cookies(context.cookies())
    if not _has_phpsessid(cookies):
        return None
    header = cookies_to_header(cookies)
    if not session_is_valid(header, order_url()):
        return None
    return SmileSession.from_playwright_cookies(cookies, session_region=region())


def _click_google_login(page: Any, context: Any) -> None:
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    labels = (
        "Entrar com Google",
        "Login with Google",
        "Sign in with Google",
        "Masuk dengan Google",
    )
    for label in labels:
        try:
            btn = page.get_by_text(label, exact=True)
            if not btn.count() or not btn.is_visible():
                continue
            try:
                with context.expect_page(timeout=15_000) as popup_info:
                    btn.click()
                popup = popup_info.value
                popup.wait_for_load_state("domcontentloaded", timeout=30_000)
                _try_google_auto_actions(popup)
            except PlaywrightTimeout:
                btn.click()
            return
        except Exception:
            continue


def _try_google_auto_actions(page: Any) -> None:
    """Auto-advance Google OAuth when the account is already in the profile."""
    url = page.url

    if "policies.google.com" in url or "policies.youtube.com" in url:
        try:
            page.close()
        except Exception:
            pass
        return

    if "consent.google" in url:
        _click_button_by_words(page, ("accept", "agree", "got it", "ok", "yes", "allow"))
        return

    if "accounts.google.com" not in url:
        return

    account_selectors = [
        "div[data-identifier]",
        "[data-email]",
        "div[role='link'][data-identifier]",
        "li[role='option']",
    ]
    for sel in account_selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() and loc.is_visible():
                loc.click(timeout=5_000)
                page.wait_for_load_state("domcontentloaded", timeout=20_000)
                break
        except Exception:
            continue

    _click_button_by_words(page, ("continue", "continuar", "next", "siguiente", "allow", "yes", "ok"))


def _click_button_by_words(page: Any, words: tuple[str, ...]) -> bool:
    for btn in page.locator("button, [role='button']").all():
        try:
            label = (btn.inner_text(timeout=1_000) or "").strip().lower()
            if any(w in label for w in words) and btn.is_visible():
                btn.click(timeout=5_000)
                page.wait_for_load_state("domcontentloaded", timeout=20_000)
                return True
        except Exception:
            continue
    return False


def _wait_for_smile_login(
    context: Any,
    page: Any,
    *,
    wait_seconds: int | None = None,
) -> None:
    deadline = time.time() + (wait_seconds or login_wait_seconds())
    last_status = ""

    while time.time() < deadline:
        cookies = filter_smile_cookies(context.cookies())
        if _has_phpsessid(cookies):
            header = cookies_to_header(cookies)
            if session_is_valid(header, order_url()):
                return

        for tab in context.pages:
            url = tab.url
            if "policies.google.com" in url or "policies.youtube.com" in url:
                try:
                    tab.close()
                except Exception:
                    pass
                status = "Auto: closed policy tab…"
            elif "consent.google" in url:
                _try_google_auto_actions(tab)
                status = "Auto: Google consent…"
            elif "accounts.google.com" in url:
                _try_google_auto_actions(tab)
                status = "Auto: Google OAuth…"
            elif "smile.one" in url and _LOGIN_PATH not in url:
                if not _page_looks_like_login(tab):
                    cookies = filter_smile_cookies(context.cookies())
                    if _has_phpsessid(cookies):
                        return
                status = "Auto: Smile.one redirect…"
            elif _LOGIN_PATH in tab.url:
                status = "Auto: login page…"
            else:
                status = f"Auto: {tab.url[:50]}…"

            if status != last_status:
                print(status, file=sys.stderr)
                last_status = status

        time.sleep(1)

    raise SmileAuthError(
        f"Automated login timed out after {wait_seconds or login_wait_seconds()}s. "
        "If this is the first run, complete setup with:\n"
        "  SMILE_HEADLESS=false python scripts/smileone_setup.py"
    )


def _page_looks_like_login(page: Any) -> bool:
    try:
        content = page.content()
        url = page.url
    except Exception:
        return True
    if "balance-coins" in content:
        return False
    if _LOGIN_PATH in url:
        return True
    if "customer/account/login" in content:
        return True
    if _LOGIN_TITLE_RE.search(content):
        return True
    if "Login with Google" in content or "Entrar com Google" in content:
        return True
    return False
