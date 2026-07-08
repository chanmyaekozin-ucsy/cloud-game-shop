#!/bin/sh
set -e
cd "$(dirname "$0")/.." || exit 1
mkdir -p .data

# Only one bot may poll Telegram at a time (duplicate instances cause 409 + ghost replies).
for pid in $(pgrep -f "bot/main.py" 2>/dev/null || true); do
  case "$(ps -p "$pid" -o command= 2>/dev/null)" in
    *"Cloud Game Shop"*)
      echo "Stopping previous bot (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      ;;
  esac
done
sleep 1

exec .venv/bin/python3 bot/main.py
