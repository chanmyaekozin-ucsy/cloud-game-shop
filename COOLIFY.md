# Deploy Cloud Game Shop on Coolify

This bot is a **long-running worker** (Telegram polling + Playwright). It does not expose an HTTP port.

## Prerequisites

- A Coolify server (self-hosted or Cloud) with Docker
- GitHub repo connected: `https://github.com/chanmyaekozin-ucsy/cloud-game-shop`
- Smile.one browser profile + session already set up locally (see below)
- KBZ session JSON if you use auto-verify

## 1. Create the resource

1. In Coolify: **Project → Environment → + New Resource**
2. Choose **Docker Compose**
3. Connect the GitHub repository and branch `main`
4. Compose file: `docker-compose.yml`
5. No domain or port mapping is required (worker only)

## 2. Environment variables

Copy values from `.env.example` into Coolify **Environment Variables** for this service.

| Variable | Required | Notes |
|----------|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_ADMIN_IDS` | Yes | Comma-separated Telegram user IDs |
| `TELEGRAM_ADMIN_USERNAME` | Yes | Without `@` |
| `PAYMENTS_PROOFS_GROUP_ID` | Yes | Telegram group ID for proofs + monitor |
| `KBZ_MERCHANT_NAME` | Yes | Shown on payment screens |
| `KBZ_MERCHANT_PHONE` | Yes | |
| `KBZ_PAY_PHONE` | Yes | |
| `SMILE_REGION` | Yes | e.g. `br` |
| `SMILE_ORDER_URL` | Yes | e.g. `https://www.smile.one/br/customer/order` |
| `GEMINI_KEY` | If using receipt OCR | |
| `TELEGRAM_PROXY_URL` | Optional | Useful if Telegram API is slow/blocked |
| `SMILE_BROWSER_CHANNEL` | **Leave empty** | Container uses bundled Chromium, not Chrome |
| `SMILE_REFRESH_HEADLESS` | `true` | Recommended in Docker |
| `SQLITE_PATH` | `.data/cloud_gameshop.sqlite3` | Default is fine |
| `KBZ_SESSION_PATH` | `.data/kbz_session.json` | Default is fine |

Coolify injects these at runtime; `.env` is not shipped in the image.

## 3. Persistent data (important)

The compose file mounts a named volume `bot-data` at `/app/.data`. This stores:

- SQLite database (`cloud_gameshop.sqlite3`)
- Smile.one session + browser profile
- KBZ session JSON

**On redeploy, keep volumes** when Coolify asks — otherwise orders and sessions are lost.

### Seed data from your machine (first deploy)

After the first deploy, copy your local `.data` into the container volume:

```bash
# On the Coolify server — find the container name
docker ps --filter name=bot

# Copy local files into the running container (run from your laptop)
scp -r .data/ user@your-server:/tmp/cloud-gameshop-data
ssh user@your-server 'docker cp /tmp/cloud-gameshop-data/. <container_name>:/app/.data/'
```

Or use Coolify **Terminal** on the bot container and upload files via `docker cp` from the host.

Minimum files to copy:

- `.data/smileone_session.json`
- `.data/browser_profile/` (entire directory)
- `.data/browser_profile_ready` (flag file)
- `.data/kbz_session.json` (if using KBZ auto-verify)

### One-time Smile.one setup (if not seeded)

If you have not run setup locally:

```bash
# Coolify terminal → bot container
python scripts/smileone_setup.py
```

This needs a visible browser; prefer seeding from a machine where you already ran `SMILE_HEADLESS=false python scripts/smileone_setup.py`.

## 4. Deploy

1. Click **Deploy**
2. Watch **Logs** for `Bot is ready — send /start in Telegram`
3. Ensure only **one** instance is running (Telegram 409 Conflict if duplicated)

## 5. Resource sizing

- **RAM**: 2 GB+ recommended (Playwright + Chromium)
- **shm**: `1gb` is set in compose (required for Chromium)
- **CPU**: 1–2 vCPU is usually enough for a single bot

## 6. Updates

Push to `main` → Coolify auto-deploys (if webhook enabled) or click **Redeploy**.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `409 Conflict` | Stop duplicate bot instances (local + Coolify) |
| `Browser profile not set up` | Seed `.data/browser_profile*` or run setup |
| Chromium crashes / OOM | Increase server RAM; confirm `shm_size: 1gb` |
| Telegram timeouts | Set `TELEGRAM_PROXY_URL` |
| KBZ verify fails | Refresh `kbz_session.json` in the volume |
