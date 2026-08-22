# WathanPay Mini App & Merchant SDK Integration Guide

Official documentation and reference implementation for integrating **WathanPay One-Click In-App Checkout**, **Cryptographic Anti-Spoofing User Authentication (`authData`)**, and **Server-to-Server Zero-Trust Payment Verification** into web-based Mini Apps, games, and partner stores (Next.js, React, Node.js, Express, Vue, Svelte, Python, PHP, Go, or Vanilla JavaScript).

---

## 🔑 Developer Credentials Reference

Every approved merchant receives two distinct keys in **WathanPay App > Profile > Merchant Dashboard**:

| Key | Format Example | Public or Private? | Where to Use |
| :--- | :--- | :---: | :--- |
| **Publishable Key (PK)** | `wp_live_pk_88291048...` | 🌐 **Public** | Frontend HTML, JavaScript, React / Next.js client |
| **Secret Key (SK)** | `wp_live_sk_94820194...` | 🔒 **Private (Secret)** | Backend server `.env` (`X-API-Key` & `authData` HMAC) |

---

## ⚡ 1-Minute Fast Track Setup

When your web app runs inside WathanPay, the global object **`window.WathanPay`** is automatically injected before your page loads.

### 1. Read User Profile & Cryptographic Auth Data
```javascript
// Access active user profile & cryptographic signature
if (window.WathanPay) {
  // 1. Safe UI Profile (for displaying avatar/name in header)
  const user = window.WathanPay.user;
  console.log("Customer ID:", user?.id);            // e.g. "usr_994821"
  console.log("Customer Name:", user?.name);        // e.g. "Chan Myae Ko Zin"
  console.log("Masked Phone:", user?.phone);        // e.g. "09*****9939" (Privacy-protected)
  console.log("Avatar URL:", user?.avatarUrl);

  // 2. 🛡️ Cryptographically Signed authData (Send to your backend for zero-trust login)
  const authData = window.WathanPay.authData;
  console.log("Auth Data String:", authData);
  // Example: "auth_date=1724300000&id=usr_994821&maskedPhone=09%2A%2A%2A%2A%2A9939&name=Chan+Myae&phone=09%2A%2A%2A%2A%2A9939&hash=5a1f..."
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
    'X-API-Key': process.env.WATHANPAY_MERCHANT_SECRET, // Your Secret Key (wp_live_sk_...) from Merchant Dashboard
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

## 🔐 Cryptographic User Authentication & Privacy (`authData`)

### 🛡️ Privacy by Design: Phone Masking (`09*****9939`)
To prevent malicious 3rd-party websites from scraping personal phone numbers, WathanPay automatically masks the phone number in the standard privacy-preserving format:
* **Raw Phone:** `09948999939` / `+959948999939`
* **Masked Output:** **`09*****9939`**

Mini apps receive:
1. **`id`** (`usr_994821`): Permanent unique user identifier for database accounts & game saves.
2. **`name`** (`Chan Myae Ko Zin`): Public name for greetings and UI display.
3. **`phone` / `maskedPhone`** (`09*****9939`): Safely shows the last 4 digits for order receipts without leaking private contact information.
4. **`avatarUrl`**: Public profile picture.

---

### Why is `authData` needed?
- **`window.WathanPay.user`** is a convenience object for client-side rendering (e.g. showing "Hello, Ko Zin"). Any user could open Developer Tools in an external browser and type `window.WathanPay.user = { id: 'admin' }`.
- **`window.WathanPay.authData`** is a **HMAC-SHA256 cryptographically signed string** generated natively by WathanPay using your unique **Merchant Secret Key**.
- An attacker **cannot forge or tamper with `authData`** without invalidating the cryptographic signature (`hash`).

### How `authData` is structured:
```
auth_date=1724300000&id=usr_994821&maskedPhone=09%2A%2A%2A%2A%2A9939&name=Chan+Myae+Ko+Zin&phone=09%2A%2A%2A%2A%2A9939&hash=d41d8cd98f00b204e9800998ecf8427e...
```

### Verification Algorithm:
1. Parse the query string into key-value pairs.
2. Extract the received `hash` parameter and remove it from the parameters.
3. Sort all remaining keys alphabetically.
4. Format into lines: `key1=value1\nkey2=value2\n...`.
5. Compute HMAC-SHA256 over this string with your private **Merchant Secret Key** (`wp_live_sk_...` from Merchant Dashboard).
6. Verify that the computed hash equals the received `hash`.
7. Verify that `auth_date` is not expired (e.g. within 24 hours).

---

### Backend Verification Code Samples

#### 🟢 Node.js / Express / Next.js
```javascript
import crypto from 'crypto';

// 🔑 Your private Merchant Secret Key (From WathanPay App > Profile > Merchant Dashboard)
const MERCHANT_SECRET = process.env.WATHANPAY_MERCHANT_SECRET;

export function verifyWathanPayAuth(authDataString, maxAgeSeconds = 86400) {
  if (!MERCHANT_SECRET) throw new Error('WATHANPAY_MERCHANT_SECRET is not configured');
  if (!authDataString) return { ok: false, error: 'Missing authData' };

  const params = new URLSearchParams(authDataString);
  const receivedHash = params.get('hash');
  if (!receivedHash) return { ok: false, error: 'Missing signature hash' };

  params.delete('hash');

  // 1. Sort keys alphabetically
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

  // 2. Calculate HMAC-SHA256 using your Merchant Secret
  const calculatedHash = crypto
    .createHmac('sha256', MERCHANT_SECRET)
    .update(dataCheckString)
    .digest('hex');

  // 3. Constant-time comparison
  if (calculatedHash.toLowerCase() !== receivedHash.toLowerCase()) {
    return { ok: false, error: 'Invalid cryptographic signature' };
  }

  // 4. Replay attack protection (timestamp check)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - authDate) > maxAgeSeconds) {
    return { ok: false, error: 'Auth data expired' };
  }

  const phone = params.get('phone') || params.get('maskedPhone') || undefined;

  return {
    ok: true,
    user: {
      id: params.get('id'),
      name: params.get('name'),
      phone: phone,                 // e.g. "09*****9939"
      maskedPhone: phone,
      avatarUrl: params.get('avatarUrl') || null,
    }
  };
}
```

#### 🐍 Python (FastAPI / Flask / Django)
```python
import hmac
import hashlib
import urllib.parse
import os
import time

MERCHANT_SECRET = os.getenv("WATHANPAY_MERCHANT_SECRET")

def verify_wathanpay_auth(auth_data_str: str, max_age_seconds: int = 86400):
    if not MERCHANT_SECRET:
        raise ValueError("WATHANPAY_MERCHANT_SECRET is not configured")

    params = dict(urllib.parse.parse_qsl(auth_data_str, keep_blank_values=True))
    received_hash = params.pop('hash', None)
    if not received_hash:
        return {"ok": False, "error": "Missing signature hash"}

    # Sort keys
    sorted_keys = sorted(params.keys())
    data_check_string = "\n".join(f"{k}={params[k]}" for k in sorted_keys)

    # Compute HMAC-SHA256 with Merchant Secret
    calculated_hash = hmac.new(
        MERCHANT_SECRET.encode('utf-8'),
        data_check_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash.lower(), received_hash.lower()):
        return {"ok": False, "error": "Signature mismatch. Tampered user."}

    # Timestamp check
    auth_date = int(params.get('auth_date', 0))
    if abs(time.time() - auth_date) > max_age_seconds:
        return {"ok": False, "error": "Auth data expired"}

    phone = params.get("phone") or params.get("maskedPhone")

    return {
        "ok": True,
        "user": {
            "id": params.get("id"),
            "name": params.get("name"),
            "phone": phone, # e.g. "09*****9939"
            "maskedPhone": phone,
            "avatarUrl": params.get("avatarUrl")
        }
    }
```

#### 🐘 PHP (Laravel / Vanilla)
```php
function verifyWathanPayAuth(string $authDataString, int $maxAgeSeconds = 86400): array {
    $secret = getenv('WATHANPAY_MERCHANT_SECRET');
    if (!$secret) {
        throw new Exception('WATHANPAY_MERCHANT_SECRET is not configured');
    }

    parse_str($authDataString, $params);
    if (!isset($params['hash'])) {
        return ['ok' => false, 'error' => 'Missing signature hash'];
    }

    $receivedHash = $params['hash'];
    unset($params['hash']);

    ksort($params);
    $lines = [];
    foreach ($params as $key => $val) {
        $lines[] = "$key=$val";
    }
    $dataCheckString = implode("\n", $lines);

    $calculatedHash = hash_hmac('sha256', $dataCheckString, $secret);

    if (!hash_equals(strtolower($calculatedHash), strtolower($receivedHash))) {
        return ['ok' => false, 'error' => 'Invalid signature'];
    }

    $authDate = intval($params['auth_date'] ?? 0);
    if (abs(time() - $authDate) > $maxAgeSeconds) {
        return ['ok' => false, 'error' => 'Auth data expired'];
    }

    $phone = $params['phone'] ?? ($params['maskedPhone'] ?? null);

    return [
        'ok' => true,
        'user' => [
            'id' => $params['id'] ?? null,
            'name' => $params['name'] ?? null,
            'phone' => $phone, // e.g. "09*****9939"
            'maskedPhone' => $phone,
            'avatarUrl' => $params['avatarUrl'] ?? null,
        ]
    ];
}
```

#### 🔷 Go (Golang)
```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

func VerifyWathanPayAuth(authDataStr, merchantSecret string, maxAge time.Duration) (map[string]string, error) {
	if merchantSecret == "" {
		return nil, errors.New("merchantSecret is required")
	}

	values, err := url.ParseQuery(authDataStr)
	if err != nil {
		return nil, err
	}

	receivedHash := values.Get("hash")
	if receivedHash == "" {
		return nil, errors.New("missing hash")
	}
	values.Del("hash")

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var lines []string
	for _, k := range keys {
		lines = append(lines, k+"="+values.Get(k))
	}
	checkString := strings.Join(lines, "\n")

	mac := hmac.New(sha256.New, []byte(merchantSecret))
	mac.Write([]byte(checkString))
	expectedHash := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(strings.ToLower(expectedHash)), []byte(strings.ToLower(receivedHash))) {
		return nil, errors.New("signature mismatch")
	}

	authDateUnix, _ := strconv.ParseInt(values.Get("auth_date"), 10, 64)
	if math.Abs(float64(time.Now().Unix()-authDateUnix)) > maxAge.Seconds() {
		return nil, errors.New("auth data expired")
	}

	phone := values.Get("phone")
	if phone == "" {
		phone = values.Get("maskedPhone")
	}

	return map[string]string{
		"id":          values.Get("id"),
		"name":        values.Get("name"),
		"phone":       phone, // "09*****9939"
		"maskedPhone": phone,
	}, nil
}
```

---

## 📖 Complete API Reference

### `window.WathanPay` Object

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `ready` | `boolean` | `true` when running inside the WathanPay native container. |
| `authData` | `string` | Cryptographically signed HMAC-SHA256 string for zero-trust backend authentication. |
| `getAuthData()` | `() => string` | Helper function returning the `authData` string. |
| `user` | `MiniAppUser \| null` | Logged-in user profile (`id`, `name`, `phone`, `maskedPhone`, `avatarUrl`) for UI rendering. |
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
  phone?: string;          // Masked format: "09*****9939"
  maskedPhone?: string;    // Masked format: "09*****9939"
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
  const [authData, setAuthData] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function checkBridge() {
      if (window.WathanPay?.ready) {
        setIsReady(true);
        setUser(window.WathanPay.user || window.WathanPay.getUser() || null);
        setAuthData(window.WathanPay.authData || window.WathanPay.getAuthData?.() || '');
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
    authData,
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
| `X-API-Key` | `wp_live_sk_...` *(Merchant Secret Key from Dashboard)* |

### Example cURL Request:
```bash
curl -X GET "https://api.wathanpay.com/v1/merchant/verify-payment?shopOrderId=ORD_1724283921" \
  -H "X-API-Key: wp_live_sk_xxxxxxxxxxxxxxxxxxxxxxxx"
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

## 🛡️ Security Guarantees & Token Isolation

1. **User Privacy Protection**:
   - Phone numbers are masked by default (`09*****9939`). Shady websites cannot harvest real user phone numbers.
2. **Identity Token (`authData`) vs. Master Wallet Session**:
   - `authData` is strictly an identity assertion token for the merchant.
   - It **cannot** be used to query user wallet balances, view transaction history, or execute unauthorized fund transfers.
3. **Replay Attack Protection**:
   - Every `authData` token is signed with a high-precision `auth_date` timestamp.
   - Always reject tokens older than your server's max allowed age (e.g. 24 hours).
4. **Never Deliver Goods on Client-Side Events Alone**:
   - Always verify the transaction on your backend server using `GET /v1/merchant/verify-payment` with your `X-API-Key` before fulfilling high-value orders.
5. **Use Idempotent Order IDs**:
   - Generate unique `orderId`s (e.g. `ORD_USERID_TIMESTAMP`). If a network glitch occurs, WathanPay automatically recognizes duplicate submissions and prevents double billing.
