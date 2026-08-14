# Cloud Game Shop (web)

Standalone shop at http://localhost:3000. Inside WathanPay it opens as a mini-app.

```bash
cd web
npm install
npm run dev
```

| Role | Login | PIN |
|------|-------|-----|
| User | `09970000000` | `123456` |
| Admin | from `ADMIN_EMAIL` / `ADMIN_PIN` in `.env` | |

**Standalone web** — after a package, choose KBZPay or WavePay, transfer, then confirm with TxID last 5.

**WathanPay mini-app** — after a package, the shop creates an order and WathanPay pays that order id with the wallet PIN. No method list.

Admin: http://localhost:3000/admin

Set `MLBB_DEMO_VERIFY=0` in production to require live account lookup.
