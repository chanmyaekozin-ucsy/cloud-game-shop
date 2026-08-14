# Deploy Cloud Game Shop **Web** on Coolify

Public URL: `https://cloudgameshop.flash-myanmar.com`

This is a **separate** Coolify resource from the Telegram bot worker. Same VPS is fine — bot has no HTTP domain; web gets the subdomain.

## Architecture (same VPS)

| Resource | Coolify type | Domain | Notes |
|----------|--------------|--------|-------|
| Telegram bot | Docker Compose (`docker-compose.yml` at repo root) | none | Long-running worker |
| **Web shop** | Dockerfile or Compose under `web/` | `cloudgameshop.flash-myanmar.com` | Next.js on port **3000** |
| Dominate PGW | your existing Dominate app | internal or public | KBZ/Wave methods + verify |
| Other shops | separate resources | `*.flash-myanmar.com` | AirVPN, data packages, etc. |

Cloudflare already proxies the hostname → point the DNS A/AAAA (or CNAME) at this VPS. Coolify then terminates TLS (or Cloudflare Flexible/Full).

**Recommended Cloudflare SSL:** Full (strict) once Coolify has a cert, or Full if Coolify uses its own cert.

## 1. Create the Coolify resource

1. Coolify → **Project → + New Resource**
2. Prefer **Dockerfile** (simplest):
   - Repository: `cloud-game-shop` / branch `main`
   - **Base Directory:** `web`
   - **Dockerfile:** `Dockerfile`
   - **Port:** `3000`
3. Or **Docker Compose**:
   - Base Directory: `web`
   - Compose file: `docker-compose.yml`
4. **Domains:** add `cloudgameshop.flash-myanmar.com`
5. Enable **Generate SSL** (Let's Encrypt) unless Cloudflare handles origin differently

Do **not** put the web app in the bot compose — keep worker and HTTP shop separate so you can redeploy independently.

## 2. Persistent storage

| Path in container | Purpose |
|-------------------|---------|
| `/app/data` | `store.json`, game logo uploads |
| `/data/smileone` (optional, read-only) | Shared Smile.one session for Admin → Supplier |

In Coolify → **Persistent Storage** (Dockerfile resource):

| Host / volume | Mount |
|---------------|-------|
| Named volume `web-data` (or Coolify storage) | `/app/data` |
| Host `/data/smileone` | `/data/smileone` (read-only) |

On the VPS once:

```bash
sudo mkdir -p /data/smileone /data/kbz /data/wave /data/payments
sudo chmod 750 /data/smileone /data/kbz /data/wave /data/payments
```

Bot and web **must** use the same file:

```
SMILE_SESSION_PATH=/data/smileone/smileone_session.json
```

- Bot mounts `/data/smileone` **read-write** (login refresh writes here)
- Web mounts `/data/smileone` **read-only** (Admin → Supplier)

Seed / migrate from the old bot volume:

```bash
docker cp <bot_container>:/app/.data/smileone_session.json /data/smileone/smileone_session.json
```

Browser profile stays private on the bot volume (`/app/.data/browser_profile`). Only the session JSON is shared.

## 3. Environment variables

Set these in Coolify for the **web** resource (not the bot):

| Variable | Example | Notes |
|----------|---------|-------|
| `AUTH_SECRET` | long random string | **Required** in production |
| `ADMIN_EMAIL` | `admin@…` | Admin login email (not shown in UI) |
| `ADMIN_PIN` | 6 digits | Admin login PIN |
| `DOMINATE_GATEWAY_URL` | `http://<dominate-internal>:8080` | Same-VPS: Coolify internal hostname or `http://host.docker.internal:PORT` / host IP |
| `DOMINATE_GATEWAY_API_KEY` | `pg_…` | Cloud Game Shop project key from Dominate |
| `SMILE_REGION` | `br` | |
| `SMILE_ORDER_URL` | `https://www.smile.one/br/customer/order` | |
| `SMILE_SESSION_PATH` | `/data/smileone/smileone_session.json` | Same path as the bot |
| `SMILE_TIMEOUT` | `30` | |
| `MLBB_DEMO_VERIFY` | `0` | Production: require live nickname lookup |
| `WATHANPAY_API_URL` | optional | If mini-app charge API is used server-side |

Never put Dominate API keys in `NEXT_PUBLIC_*`.

### Dominate on the same VPS

If Dominate is another Coolify service on this host, use Coolify’s **internal URL** (e.g. `http://dominate-xxxx:8080`) so traffic stays on the Docker network. Avoid routing Dominate calls through Cloudflare unless you must.

## 4. Cloudflare checklist

1. DNS: `cloudgameshop` → this VPS (proxied orange cloud — you already have this)
2. SSL/TLS mode: **Full** or **Full (strict)**
3. Optional: Always Use HTTPS, cache bypass for `/api/*` (API should not be aggressively cached)
4. WathanPay mini-app / WebView: allow the domain in the WathanPay app allowlist if required

## 5. Deploy

1. Click **Deploy**
2. Open `https://cloudgameshop.flash-myanmar.com`
3. Admin: `https://cloudgameshop.flash-myanmar.com/admin/login`
4. Supplier tab should show Smile balance once `SMILE_SESSION_PATH` is mounted

## 6. Updates

Push to `main` → Coolify redeploys the web resource (webhook or manual). Bot and web redeploy separately.

Keep volumes when Coolify asks — wiping `/app/data` deletes shop orders and package edits.

## 7. Multi-shop pattern (`*.flash-myanmar.com`)

Same VPS pattern for each product:

1. One Coolify resource per site  
2. One subdomain in Cloudflare → same VPS IP  
3. Coolify domain = that subdomain  
4. Shared wallets stay on host mounts (`/data/kbz`, `/data/wave`, `/data/payments`) via Dominate / Payment Manager  

Example map:

| Host | App |
|------|-----|
| `cloudgameshop.flash-myanmar.com` | This Next.js shop |
| `airvpn.…` / others | Separate Coolify apps |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Cloudflare **526 Invalid SSL certificate** | Origin cert missing/invalid. In Coolify domain → open ⚙️ → ensure Let's Encrypt is issued (wait until Active). In Cloudflare SSL/TLS → set **Full** (works with Coolify LE) or **Full (strict)** only after LE is valid. Temporary: **Flexible** (HTTPS to Cloudflare, HTTP to origin) — switch back to Full after cert works. |
| 502 from Cloudflare | Web container not listening / wrong port — must be `3000` and `HOSTNAME=0.0.0.0` |
| Dominate “not configured” | Set `DOMINATE_GATEWAY_URL` + `DOMINATE_GATEWAY_API_KEY` on the **web** resource |
| Supplier “No session file” | Mount `/data/smileone` and set `SMILE_SESSION_PATH` |
| Empty shop after redeploy | Volume for `/app/data` was recreated — restore backup |
| Mixed content / cookies | Use HTTPS end-to-end; check Cloudflare SSL mode |

### Healthcheck

- Container: `GET /api/health` → `{ ok: true }`
- Coolify (Dockerfile resource): Healthcheck Path = `/api/health` (or leave Dockerfile `HEALTHCHECK`)
- Interval ~30s, start period ~40s
