# Deploy Cloud Game Shop (Unified Web + Telegram Bot Service)

Cloud Game Shop (CGS) runs as a **single unified TypeScript/Node service** (same architecture pattern as AirVPN).

- **Web Shop & Admin**: `https://cloudgameshop.flash-myanmar.com`
- **Admin Dashboard**: `/admin/packages` controls all game packages, discounts, and prices (**Single Source of Truth**).
- **Telegram Bot**: Dynamically syncs with Web store and processes orders in real-time.

---

## 1. Coolify Setup

1. In Coolify: **Project → + New Resource**
2. Select **Dockerfile**:
   - **Base Directory**: `web`
   - **Dockerfile**: `Dockerfile`
   - **Port**: `3000`
   - **Domain**: `cloudgameshop.flash-myanmar.com`

---

## 2. Environment Variables

Set these in Coolify for the service:

| Variable | Example / Description |
|----------|-----------------------|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `ADMIN_EMAIL` | Admin login email for `/admin/login` |
| `ADMIN_PASSWORD` | Secure password for Admin authentication |
| `AUTH_SECRET` | Random 32+ character string for JWT sessions |
| `DOMINATE_GATEWAY_URL` | `http://dominate-internal:8080` (or PGW URL) |
| `DOMINATE_GATEWAY_API_KEY` | `pg_...` |
| `SMILE_SESSION_PATH` | `/data/smileone/smileone_session.json` |
| `SMILE_REGION` | `br` |

---

## 3. Persistent Storage

Mount `/app/data` to persist `store.json` (orders, games, packages, prices, transactions):

| Host / Volume | Container Mount |
|---------------|-----------------|
| `web-data` | `/app/data` |
| `/data/smileone` (optional) | `/data/smileone:ro` |

---

## 4. Running Locally

```bash
cd web
npm install

# Start Next.js Web Dev Server
npm run dev

# Start Telegram Bot Worker
npm run bot
```
