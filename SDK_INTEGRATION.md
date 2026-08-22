# WathanPay Mini App & Merchant SDK Integration Guide

Official documentation and reference implementation for integrating **WathanPay One-Click In-App Checkout**, **Safe User Profile Sharing**, and **Server-to-Server Zero-Trust Payment Verification** into web-based Mini Apps, games, and partner stores (Next.js, React, Node.js, Express, Vue, Svelte, or Vanilla JavaScript).

---

## ⚡ 1-Minute Fast Track Setup

When your web app runs inside WathanPay, the global object **`window.WathanPay`** is automatically injected before your page loads.

### 1. Read Logged-In User Profile
```javascript
// Access the active user's safe public profile (no private credentials exposed)
if (window.WathanPay && window.WathanPay.user) {
  const user = window.WathanPay.user;
  console.log("Customer ID:", user.id);
  console.log("Customer Name:", user.name);        // e.g. "Chan Myae Ko Zin"
  console.log("Customer Phone:", user.phone);      // e.g. "09948999939"
  console.log("Avatar URL:", user.avatarUrl);      // e.g. "https://api.wathanpay.com/v1/media/avatars/..."
}
```

### 2. Trigger In-App 1-Click Checkout
```javascript
// Opens WathanPay's native bottom sheet PIN pad & Face ID / Fingerprint
const result = await window.WathanPay.pay({
  orderId: 'ORD_' + Date.now(),             // Unique Order ID (alphanumeric, 6-120 chars)
  amount: 5000,                             // Amount in Myanmar Kyats (>= 100 Ks)
  title: '💎 500 Diamonds Pack',            // Product / Item Name displayed on confirmation sheet
  subtitle: 'Player ID: 994821 (Server 1)', // Optional description / player info
});

if (result.ok) {
  console.log('Payment Succeeded! Ledger TxID:', result.txid);
  // Notify your backend server with orderId and txid
  await submitOrderToBackend({ orderId, wathanpayTxnId: result.txid });
} else {
  console.warn('Payment Cancelled or Failed:', result.message);
}
```

### 3. Server-to-Server Payment Verification (Backend)
In your order fulfillment route (Node.js / Express / Next.js API route / Python / PHP / Go):
```javascript
// 🛡️ Bank-grade verification against WathanPay Core Ledger
const res = await fetch(`https://api.wathanpay.com/v1/merchant/verify-payment?shopOrderId=${orderId}`, {
  headers: {
    'X-API-Key': process.env.WATHANPAY_API_KEY, // From WathanPay App > Profile > Merchant Dashboard
  },
});
const verification = await res.json();

if (!verification.ok || !verification.verified || verification.status !== 'succeeded') {
  return res.status(400).json({ error: verification.message || 'Payment not verified' });
}

// Ensure paid amount matches product price
if (verification.amountKs !== expectedAmount) {
  return res.status(400).json({ error: 'Amount mismatch detected' });
}

// ✅ 100% Safe to deliver digital goods / diamonds / subscription!
await deliverProduct({ orderId, txid: verification.transactionId });
```

---

## 📖 Complete API Reference

### `window.WathanPay` Object

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `ready` | `boolean` | `true` when running inside the WathanPay native container. |
| `user` | `MiniAppUser \| null` | Logged-in user profile (`id`, `name`, `phone`, `avatarUrl`). |
| `getUser()` | `() => MiniAppUser \| null` | Helper function returning the user profile. |
| `pay(params, callback?)` | `Promise<PayResult>` | Opens the native biometric / PIN bottom sheet for payment. |
| `close()` | `() => void` | Closes the Mini App and returns to the WathanPay home screen. |
| `setFullScreen(enabled)` | `(boolean) => void` | Toggles immersive fullscreen mode. |
| `setOrientation(mode)` | `('portrait' \| 'landscape' \| 'auto') => void` | Sets viewport orientation for games/media. |
| `requestLandscape()` | `() => void` | Switches app orientation to landscape mode. |
| `requestPortrait()` | `() => void` | Switches app orientation to portrait mode. |

---

### Payment Parameters (`PayParams`)

```typescript
export interface PayParams {
  /** Unique Order ID in your system (e.g. ORD_12345) */
  orderId: string;

  /** Payment amount in Myanmar Kyats (>= 100 Ks) */
  amount: number; // or amountKs

  /** Product or item name displayed on the payment sheet */
  title?: string;

  /** Optional subtitle, player ID, server name, or item summary */
  subtitle?: string;

  /** Optional tracking request ID */
  requestId?: string;
}
```

### Payment Result (`PayResult`)

```typescript
export interface PayResult {
  /** True if payment was authorized and settled on WathanPay ledger */
  ok: boolean;

  /** WathanPay 7-digit transaction ID (e.g. "0001048") */
  txid?: string;

  /** Error or cancellation message if ok is false */
  message?: string;

  /** Request ID matching the input */
  requestId?: string;
}
```

---

## 🛠️ Ready-to-Use React / Next.js Hook

Copy and paste this hook into your React / Next.js codebase (e.g. `src/hooks/useWathanPay.ts`):

```typescript
import { useEffect, useState, useCallback } from 'react';

export interface MiniAppUser {
  id?: string;
  name?: string;
  phone?: string;
  avatarUrl?: string | null;
}

export interface PayOptions {
  orderId: string;
  amount: number;
  title?: string;
  subtitle?: string;
}

export interface PayResult {
  ok: boolean;
  txid?: string;
  message?: string;
}

export function useWathanPay() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<MiniAppUser | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function checkBridge() {
      if (window.WathanPay?.ready) {
        setIsReady(true);
        setUser(window.WathanPay.user || window.WathanPay.getUser() || null);
      }
    }

    checkBridge();
    window.addEventListener('WathanPayReady', checkBridge);
    window.addEventListener('WathanPayBridgeReady', checkBridge);

    return () => {
      window.removeEventListener('WathanPayReady', checkBridge);
      window.removeEventListener('WathanPayBridgeReady', checkBridge);
    };
  }, []);

  const pay = useCallback(
    async (options: PayOptions): Promise<PayResult> => {
      if (!window.WathanPay?.pay) {
        throw new Error('WathanPay SDK not available in this browser');
      }
      return window.WathanPay.pay({
        orderId: options.orderId,
        amountKs: options.amount,
        title: options.title,
        subtitle: options.subtitle,
      });
    },
    []
  );

  const close = useCallback(() => {
    window.WathanPay?.close?.();
  }, []);

  return {
    isInsideApp: isReady,
    user,
    pay,
    close,
  };
}
```

---

## 🔒 Server-Side Payment Verification API

Merchants **must** verify all transactions with WathanPay's core ledger before delivering items or digital products.

### Endpoint
`GET https://api.wathanpay.com/v1/merchant/verify-payment`  
`POST https://api.wathanpay.com/v1/merchant/verify-payment`

### Query / Body Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `shopOrderId` | `string` | **Yes** (or `transactionId`) | Your internal order ID (e.g. `ORD_1724283921`) |
| `transactionId` | `string` | Optional | WathanPay 7-digit transaction ID returned by frontend |
| `amountKs` | `number` | Optional | Expected amount to verify against ledger record |

### Headers
| Header | Value |
| :--- | :--- |
| `X-API-Key` | `wp_live_pk_...` *(From Merchant Dashboard)* |

### Example cURL Request:
```bash
curl -X GET "https://api.wathanpay.com/v1/merchant/verify-payment?shopOrderId=ORD_1724283921" \
  -H "X-API-Key: wp_live_pk_xxxxxxxxxxxxxxxxxxxxxxxx"
```

### Successful Response (`200 OK`):
```json
{
  "ok": true,
  "verified": true,
  "status": "succeeded",
  "transactionId": "0001048",
  "shopOrderId": "ORD_1724283921",
  "amountKs": 5000,
  "paidAt": "2026-08-22T02:40:00.000Z",
  "createdAt": "2026-08-22T02:40:00.000Z"
}
```

---

## 💡 Best Practices

1. **Always Pass `title` & `subtitle`**:
   Providing clear item names like `"💎 500 Diamonds"` and `"Player ID: 12345"` gives users confidence and significantly increases checkout completion rates.
2. **Never Deliver Goods on Client-Side Events Alone**:
   Always verify the transaction on your backend server using `GET /v1/merchant/verify-payment` with your `X-API-Key` before fulfilling high-value orders.
3. **Use Idempotent Order IDs**:
   Generate unique `orderId`s (e.g. `ORD_USERID_TIMESTAMP`). If a network glitch occurs, WathanPay automatically recognizes duplicate submissions and prevents double billing.
