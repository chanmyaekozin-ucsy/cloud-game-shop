# Deploy Cloud Game Shop on Coolify

Two resources on the **same VPS**:

| App | Docs |
|-----|------|
| **Web shop** (`cloudgameshop.flash-myanmar.com`) | [`web/COOLIFY.md`](web/COOLIFY.md) |
| **Telegram bot** (worker, no domain) | sections below |

---

# Telegram bot (worker)

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
| `SMILE_SESSION_PATH` | Yes on Coolify | `/data/smileone/smileone_session.json` (shared with web) |
| `GEMINI_KEY` | If using receipt OCR | |
| `TELEGRAM_PROXY_URL` | Optional | Useful if Telegram API is slow/blocked |
| `SMILE_BROWSER_CHANNEL` | **Leave empty** | Container uses bundled Chromium, not Chrome |
| `SMILE_REFRESH_HEADLESS` | `true` | Recommended in Docker |
| `SQLITE_PATH` | `.data/cloud_gameshop.sqlite3` | Default is fine |
| `KBZ_SESSION_PATH` | `/data/kbz/kbz_session.json` | **Read-only** shared file written by Donimate Payment Manager |
| `KBZ_CLAIMED_TX_PATH` | `/data/kbz/kbz_claimed_txs.sqlite3` | Shared used-tx ledger (blocks one KBZ transfer across AirVPN + Game Shop) |
| `WAVE_SESSION_PATH` | `/data/wave/wave_session.json` | **Read-only** Wave session from Payment Manager |
| `WAVE_MERCHANT_NAME` / `WAVE_PAY_PHONE` | Yes for Wave | Shown on Wave payment screen (overridden by Payment Manager catalog when ON) |
| `SHOP_PAYMENT_ACCOUNTS_PATH` | `/data/payments/shop_payment_accounts.json` | **Read-only** ON/OFF catalog from Payment Manager |

Coolify injects these at runtime; `.env` is not shipped in the image.

## 3. Persistent data (important)

The compose file mounts:

| Mount | Purpose |
|-------|---------|
| `bot-data` → `/app/.data` | **Private** — SQLite, Smile.one **browser profile** |
| host `/data/smileone` → `/data/smileone` | **Shared** Smile.one `smileone_session.json` (bot writes; web reads) |
| host `/data/kbz` → `/data/kbz` | **Shared** merchant `kbz_session.json` + claimed txs |
| host `/data/wave` → `/data/wave` | **Shared** merchant `wave_session.json` |
| host `/data/payments` → `/data/payments` | **Shared** shop payment ON/OFF catalog (PM writes) |

Set:

```
SMILE_SESSION_PATH=/data/smileone/smileone_session.json
KBZ_SESSION_PATH=/data/kbz/kbz_session.json
WAVE_SESSION_PATH=/data/wave/wave_session.json
SHOP_PAYMENT_ACCOUNTS_PATH=/data/payments/shop_payment_accounts.json
```

**Do not** put the Smile **browser profile** or SQLite on the shared volume. Only the session JSON is shared with the web shop.

### Shared KBZ session (Payment Manager is the only writer)

On the host once:

```bash
sudo mkdir -p /data/kbz /data/wave /data/payments /data/smileone
sudo chmod 750 /data/kbz /data/wave /data/payments /data/smileone
```

| Role | App |
|------|-----|
| **Write** session + shop catalog | **Donimate Payment Manager only** |
| **Read** session + catalog (verify / pay UI) | Cloud Game Shop, AirVPN |

Attach host `/data/kbz`, `/data/wave`, and `/data/payments` to all three containers. Shop bots must **not** upload tokens, refresh from Frida logs, run wallet login, or edit the catalog.

Enable accounts per shop from Payment Manager → **Shop Payments**. Zero ON accounts → buyers get Admin redirect only.

Seed / renew the session from Payment Manager (Session menu or Login).

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

- `/data/smileone/smileone_session.json` (shared with web; or copy from old `.data/smileone_session.json`)
- `.data/browser_profile/` (entire directory — stays on bot-data volume)
- `.data/browser_profile_ready` (flag file)
- Prefer shared host file `/data/kbz/kbz_session.json` (written by Payment Manager)

Migrate an existing bot session onto the shared path:

```bash
docker cp <bot_container>:/app/.data/smileone_session.json /data/smileone/smileone_session.json
```

Then set `SMILE_SESSION_PATH=/data/smileone/smileone_session.json` on **both** bot and web.

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
