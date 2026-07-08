"""One-time browser profile setup for unattended auto-refresh."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from providers.smileone.auth import SmileAuthError, setup_browser_profile
from providers.smileone.config import load_env, order_url
from providers.smileone.http import fetch_html, parse_balance


def main() -> int:
    load_env()
    print("=" * 60)
    print("ONE-TIME SETUP — sign in with Google in the browser window")
    print("After this, session refresh is 100% automatic (headless).")
    print("=" * 60)
    print()

    try:
        session = setup_browser_profile()
    except SmileAuthError as e:
        print(f"Setup failed: {e}", file=sys.stderr)
        return 1

    print(f"\nSession saved: {session.path}")
    try:
        html, _ = fetch_html(order_url(), session.cookie_header, timeout=30)
        balance = parse_balance(html)
        if balance:
            print(f"Balance: {balance}")
    except Exception as e:
        print(f"Balance check skipped: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
