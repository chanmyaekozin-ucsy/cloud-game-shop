#!/usr/bin/env python3
"""Read-only KBZ session probe for Cloud Game Shop.

Session writes (login / upload / token refresh) belong only to
Donimate Payment Manager. This script only checks whether the shared
session file works.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from bot import config  # noqa: E402
from payments.kbz.session_store import probe_session  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe shared KBZ session (read-only). Use Payment Manager to update."
    )
    parser.add_argument(
        "--session",
        default=config.KBZ_SESSION_PATH,
        help=f"Session JSON path (default: {config.KBZ_SESSION_PATH})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        default=True,
        help="Test whether the current session works (default)",
    )
    args = parser.parse_args()
    session_path = Path(args.session)

    print(
        "Note: Cloud Game Shop does not write KBZ sessions.\n"
        "Manage login / upload in Donimate Payment Manager.\n"
    )
    ok, err = probe_session(session_path)
    if ok:
        print("OK — KBZ session is valid")
        return 0
    print(f"INVALID — {err}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
