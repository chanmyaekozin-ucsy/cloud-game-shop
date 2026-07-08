#!/usr/bin/env python3
"""Update kbz_session.json token from CLI or a Frida/Reqable capture log."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from bot import config  # noqa: E402
from payments.kbz.session_store import (  # noqa: E402
    probe_session,
    try_refresh_token_from_log,
    update_token_from_plaintext_capture,
    update_token_in_session_file,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update KBZPay session token for Cloud Game Shop auto-verify."
    )
    parser.add_argument(
        "--token",
        help="New session token string (from KBZPay app capture)",
    )
    parser.add_argument(
        "--from-log",
        metavar="PATH",
        help="Frida/Reqable log file with embedded token JSON",
    )
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Plaintext JSON/log file containing token",
    )
    parser.add_argument(
        "--paste",
        action="store_true",
        help="Read plaintext JSON from stdin (paste Frida output, then Ctrl-D)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only test whether the current session works",
    )
    parser.add_argument(
        "--session",
        default=config.KBZ_SESSION_PATH,
        help=f"Session JSON path (default: {config.KBZ_SESSION_PATH})",
    )
    args = parser.parse_args()
    session_path = Path(args.session)

    if args.check:
        ok, err = probe_session(session_path)
        if ok:
            print("OK — KBZ session is valid")
            return 0
        print(f"INVALID — {err}")
        return 1

    if args.from_log:
        changed, token = try_refresh_token_from_log(session_path, Path(args.from_log))
        if not changed:
            print("No newer token found in log")
            return 1
        print(f"Updated token from log …{token[-13:] if token else ''}")
    elif args.from_json:
        text = Path(args.from_json).read_text(encoding="utf-8", errors="replace")
        changed, token = update_token_from_plaintext_capture(session_path, text)
        if not changed:
            if token:
                print("Token unchanged")
                return 1
            print("No token found in file")
            return 1
        print(f"Updated token from JSON …{token[-13:] if token else ''}")
    elif args.paste:
        text = sys.stdin.read()
        changed, token = update_token_from_plaintext_capture(session_path, text)
        if not changed:
            if token:
                print("Token unchanged")
                return 1
            print("No token in pasted text")
            return 1
        print(f"Updated token …{token[-13:] if token else ''}")
    elif args.token:
        if not update_token_in_session_file(session_path, args.token.strip()):
            print("Token unchanged")
            return 1
        print("Token updated")
    else:
        parser.error("Use --token, --from-log, --from-json, --paste, or --check")

    ok, err = probe_session(session_path)
    if ok:
        print("Verified — session works")
        return 0
    print(f"Warning — session still invalid: {err}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
