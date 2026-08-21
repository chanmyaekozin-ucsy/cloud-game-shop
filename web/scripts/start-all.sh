#!/bin/sh
set -e

# Fix volume permissions on mounted directories at runtime
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data /app/data/uploads/games /app/.data
  chown -R node:node /app/data /app/.data 2>/dev/null || true
  chmod -R 775 /app/data /app/.data 2>/dev/null || true
  if command -v su-exec >/dev/null 2>&1; then
    exec su-exec node "$0" "$@"
  fi
fi

if [ -n "$BOT_TOKEN" ] || [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo "[Startup] Launching Telegram bot in background..."
  if [ -f "dist/bot.js" ]; then
    node dist/bot.js &
  elif [ -f "src/bot/bot.ts" ]; then
    npx tsx src/bot/bot.ts &
  fi
else
  echo "[Startup] BOT_TOKEN not set, skipping Telegram bot start."
fi

echo "[Startup] Starting Next.js web application on port ${PORT:-3000}..."
if [ -f "server.js" ]; then
  exec node server.js
else
  exec npm start
fi
