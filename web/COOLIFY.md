# Deploy Cloud Game Shop (Unified Service)

Public URL: `https://cloudgameshop.flash-myanmar.com`

Cloud Game Shop runs a **single unified service** containing both the Web storefront / Admin dashboard and the Telegram bot worker.

## Architecture

| Resource | Service Type | Domain | Notes |
|----------|--------------|--------|-------|
| **CGS Unified Service** | Dockerfile (`web/Dockerfile`) | `cloudgameshop.flash-myanmar.com` | Next.js on port 3000 + Telegram Bot worker |
| Dominate PGW | Existing Dominate app | internal or public | KBZPay / WavePay payments & verification |

Admin web at `/admin/packages` is the **Single Source of Truth** for all pricing, discounts, and packages. The Telegram Bot syncs live without separate database sync.

---

## 1. Coolify Deployment

1. Coolify → **Project → + New Resource**
2. Choose **Dockerfile**:
   - **Base Directory**: `web`
   - **Dockerfile**: `Dockerfile`
   - **Port**: `3000`
   - **Domain**: `cloudgameshop.flash-myanmar.com`
3. Enable **Generate SSL** (Let's Encrypt).

---

## 2. Persistent Storage

| Host / volume | Mount | Purpose |
|---------------|-------|---------|
| `web-data` (named volume) | `/app/data` | `store.json`, game logo uploads, orders |
| Host `/data/smileone` (optional) | `/data/smileone` (read-only) | Shared Smile.one supplier session |

---

## 3. Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `BOT_TOKEN` | `123456:ABC-DEF...` | Telegram Bot token |
| `AUTH_SECRET` | random 32+ char string | JWT secret |
| `ADMIN_EMAIL` | `admin@cloudgameshop.com` | Admin email |
| `ADMIN_PASSWORD` | your secure password | Admin password |
| `DOMINATE_GATEWAY_URL` | `http://<dominate-host>:8080` | Dominate PGW endpoint |
| `DOMINATE_GATEWAY_API_KEY` | `pg_...` | Dominate project key |
| `SMILE_SESSION_PATH` | `/data/smileone/smileone_session.json` | Smile.one session file |
| `SMILE_REGION` | `br` | Smile.one region |

---

## 4. Healthcheck

- Endpoint: `GET /api/health` → `{ "ok": true }`
- Internal container check: `fetch('http://127.0.0.1:3000/api/health')`
