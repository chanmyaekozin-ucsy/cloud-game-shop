"""CLI: sign in to Smile.one with Google and write session.json."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/smileone_login.py` without installing the package.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from providers.smileone.auth import SmileAuthError, login_with_google, refresh_session
from providers.smileone.config import load_env, order_url, timeout
from providers.smileone.http import fetch_html, parse_balance


def main(argv: list[str] | None = None) -> int:
    load_env()
    p = argparse.ArgumentParser(
        description="Log in to Smile.one via Google and save session cookies.",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Always open the browser and refresh session.json.",
    )
    args = p.parse_args(argv)

    print("Automated Smile.one session refresh (headless)…\n")

    try:
        session = refresh_session() if args.force else login_with_google()
    except SmileAuthError as e:
        print(f"Login failed: {e}", file=sys.stderr)
        return 1

    print(f"Session saved: {session.path}")
    print(f"Saved at:      {session.saved_at}")
    print(f"Region:        {session.region}")

    try:
        html, _ = fetch_html(order_url(), session.cookie_header, timeout())
        balance = parse_balance(html)
        if balance:
            print(f"Balance:       {balance}")
        else:
            print("Balance:       (could not parse — session may still be valid)")
    except Exception as e:
        print(f"Balance check: skipped ({e})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
