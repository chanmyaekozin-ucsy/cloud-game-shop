#!/bin/sh
set -e

if [ -n "$BOT_TOKEN" ] || [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo "🤖 Launching Telegram bot in background..."
  npx tsx src/bot/bot.ts &
fi

echo "🚀 Starting Next.js web application on port ${PORT:-3000}..."
if [ -f "server.js" ]; then
  exec node server.js
else
  exec npm start
fi
