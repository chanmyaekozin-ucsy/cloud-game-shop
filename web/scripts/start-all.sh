#!/bin/sh
set -e

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
