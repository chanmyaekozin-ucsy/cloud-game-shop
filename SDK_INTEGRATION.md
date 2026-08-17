# WathanPay Mini App SDK Integration Guide

Official, zero-dependency integration guide for accepting instant in-app payments on the **WathanPay** platform for Mini Apps, HTML5 Games, and E-commerce stores.

---

## 1. Quick Start (30 Seconds)

### Step 1: Trigger Payment (Frontend)
Inside your Mini App web page, `window.WathanPay` is **automatically injected** by the WathanPay mobile app. Simply call `WathanPay.pay()`:

```javascript
async function handleCheckout() {
  const result = await WathanPay.pay({
    orderId: 'ORD_' + Date.now(),
    amount: 1500,                       // Amount in MMK (multiples of 50 Ks recommended)
    title: 'Diamond Package',            // Product name
    subtitle: '100 Diamonds + 10 Bonus', // Optional description
  });

  if (result.ok) {
    console.log('Payment Succeeded! Transaction ID:', result.txid);
    alert('Thank you! Your payment was successful.');
    // Fulfill order or refresh customer balance
  } else {
    console.warn('Payment Failed or Cancelled:', result.error);
    alert('Payment was cancelled or failed: ' + result.error);
  }
}
```

---

## 2. Frontend Integration Options

### Option A: Direct Native Bridge (Recommended for Mini Apps)
When running inside WathanPay, the global object `window.WathanPay` is ready instantly. No extra imports or script tags required!

```html
<button onclick="buyNow()">Pay with WathanPay</button>

<script>
async function buyNow() {
  const res = await window.WathanPay.pay({
    orderId: 'ORDER_982341',
    amount: 5000,
    title: 'VIP 30-Day Pass'
  });

  if (res.ok) {
    location.href = '/order-success?txid=' + res.txid;
  }
}
</script>
```

---

### Option B: HTML Script Tag (For Browser & External Fallback)
If you want standalone web browser testing outside the mobile app:

```html
<script src="https://api.wathanpay.com/sdk.js"></script>

<script>
  // WathanPay is attached to window.WathanPay
  WathanPay.pay({
    orderId: 'ORD_1001',
    amount: 2500,
    title: 'Item Purchase'
  }).then(res => {
    if (res.ok) console.log('Paid:', res.txid);
  });
</script>
```

---

### Option C: TypeScript / Modern Bundlers (React, Next.js, Vue, Vite)
Copy `src/sdk/wathanpay.ts` into your project:

```typescript
import { WathanPay } from './wathanpay';

export function CheckoutButton() {
  const handlePay = async () => {
    const res = await WathanPay.pay({
      orderId: `ORD_${Date.now()}`,
      amount: 1000,
      title: 'Starter Pack',
    });

    if (res.ok) {
      console.log('Transaction Confirmed:', res.txid);
    }
  };

  return <button onClick={handlePay}>Pay 1,000 Ks</button>;
}
```

---

## 3. Method Reference (Client SDK)

### `WathanPay.pay(params)`
Opens the native WathanPay PIN and biometric slide-up sheet.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | `string` | **Yes** | Your store's unique order reference (e.g. `ORD_109283`). |
| `amount` | `number` | **Yes** | Amount in Myanmar Kyats (minimum `100 Ks`). |
| `title` | `string` | No | Short title displayed on customer's confirmation screen. |
| `subtitle` | `string` | No | Secondary note (e.g. `Account ID: 948172`). |

#### Return Value (`Promise<PayResult>`):
```typescript
{
  ok: boolean;       // true if payment succeeded
  txid?: string;     // 7-digit Transaction ID (e.g. '0000085')
  error?: string;    // Failure reason if cancelled or rejected
}
```

---

### `WathanPay.close()`
Closes the Mini App WebView and returns the customer back to the WathanPay home screen.

```javascript
// Example: Exit game button
document.getElementById('exitBtn').addEventListener('click', () => {
  WathanPay.close();
});
```

---

## 4. Backend Order Verification (Server-Side)

> [!IMPORTANT]
> Always verify payments on your backend server before delivering high-value digital goods or game items.

### Verification Endpoint:
```http
GET https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId={shopOrderId}
X-API-Key: {YOUR_MERCHANT_API_KEY}
```

#### cURL Example:
```bash
curl "https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId=ORD_1001" \
  -H "X-API-Key: wp_live_pk_1234567890abcdef"
```

#### Successful JSON Response:
```json
{
  "ok": true,
  "verified": true,
  "status": "succeeded",
  "transactionId": "0000085",
  "shopOrderId": "ORD_1001",
  "amountKs": 2500,
  "paidAt": "2026-08-17T13:38:00.000Z"
}
```

---

### Backend Code Examples

#### Node.js / Express / TypeScript
```javascript
import express from 'express';

const app = express();
const WATHANPAY_API_KEY = process.env.WATHANPAY_API_KEY;

app.post('/api/fulfill-order', async (req, res) => {
  const { orderId, expectedAmount } = req.body;

  // Verify on WathanPay ledger
  const response = await fetch(
    `https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId=${encodeURIComponent(orderId)}`,
    {
      headers: {
        'X-API-Key': WATHANPAY_API_KEY,
      },
    }
  );

  const data = await response.json();

  if (data.ok && data.status === 'succeeded' && data.amountKs === expectedAmount) {
    // 1. Mark order as PAID in your database
    // 2. Deliver goods / top-up diamonds
    return res.json({ success: true, txid: data.transactionId });
  }

  return res.status(400).json({ success: false, error: 'Payment not verified' });
});
```

#### Python (Flask / FastAPI)
```python
import requests

def verify_wathanpay_order(shop_order_id: str, expected_amount: int, api_key: str):
    url = f"https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId={shop_order_id}"
    headers = {"X-API-Key": api_key}
    
    resp = requests.get(url, headers=headers)
    if resp.status_code == 200:
        data = resp.json()
        if data.get("ok") and data.get("status") == "succeeded":
            if data.get("amountKs") == expected_amount:
                return True, data.get("transactionId")
    return False, None
```

#### PHP
```php
<?php
function verifyWathanPayOrder($shopOrderId, $apiKey) {
    $url = "https://api.wathanpay.com/v1/mini-apps/verify-payment?shopOrderId=" . urlencode($shopOrderId);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array(
        'X-API-Key: ' . $apiKey
    ));
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    $data = json_decode($response, true);
    return ($data && $data['ok'] && $data['status'] === 'succeeded');
}
?>
```

---

## 5. Settlement & Fee Structure

- **Gross Payment**: The total Kyats charged to the customer.
- **Merchant Discount Rate (MDR)**: Configured merchant platform fee (e.g. 5%).
- **Net Settlement**: Automatically credited to your Merchant Settlement Wallet immediately upon customer checkout.
- **Withdrawal**: Merchant earnings can be withdrawn anytime to bank accounts, KPay, WavePay, or telecom balance from the in-app Merchant Dashboard.
