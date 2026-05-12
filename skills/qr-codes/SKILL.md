---
name: paytm-qr-codes
description: >
  Paytm Dynamic QR (DQR) for in-store / counter / table-side / printed payments. Server-only flow:
  POST `/paymentservices/qr/create`, render the returned image (base64 PNG) or `qrData` (UPI deep
  link) on a screen or print it. Customer scans with any UPI app and pays. NO JS Checkout.
  Covers the required `posId`, the base64-image prefix gotcha, and post-payment polling. Load this
  skill for "QR code", "scan to pay", "in-store", "counter", "table-side", "print QR".
triggers:
  - "/paymentservices/qr/create"
  - "posId"
  - "Dynamic QR"
  - "DQR"
---

# Paytm Dynamic QR

Server-only. `POST /paymentservices/qr/create` returns an image + `qrData` UPI deep link. Display or print. Customer scans with any UPI app. Status arrives via webhook + polling.

Full reconciliation flow + error codes: `references/REFERENCE.md`.

---

## Endpoint

```
POST {BASE}/paymentservices/qr/create
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "QR_001",
    "amount": "100.00",
    "businessType": "UPI_QR_CODE",
    "posId": "POS_01"
  }
}
```

---

## When the response looks "empty" — error-parsing rule

Paytm error responses for QR (and the rest of the API) **always carry the failure reason inside `body.resultInfo`**, even when the top-level HTTP body or your client library makes it look empty. If you see something like `{}` or "QR generation failed: {}" on the frontend, the real cause is one level deep in the JSON the backend received from Paytm.

When debugging, **always log the full response body server-side** before responding to the frontend:

```js
const r = await fetch(`${PAYTM_PG_DOMAIN}/paymentservices/qr/create`, { ... });
const json = await r.json();
console.log("[paytm qr] full response:", JSON.stringify(json, null, 2));

// The reason for failure lives here, NOT in r.status or r.statusText:
const info = json?.body?.resultInfo;
if (info?.resultStatus !== "S") {
  // info.resultCode is the numeric code; info.resultMsg is the human reason
  throw new Error(`QR failed: ${info?.resultCode} ${info?.resultMsg}`);
}
```

Never report "{}" or "empty body" to the user — that's a sign the parsing missed `body.resultInfo`.

## Required fields & gotchas

- **`posId` is required.** Skipping it returns HTTP 400. Use any stable string per terminal/counter.
- **`amount` is a string with two decimals** (`"100.00"`, not `100` or `100.0`).
- Response `image` is **raw base64 PNG WITHOUT the data URI prefix.** Frontend rendering needs:
  ```js
  imgEl.src = "data:image/png;base64," + response.image;
  ```
  Forgetting the prefix shows a broken-image icon. Server-side adapters in `scripts/backend-*` already prepend it.

---

## Reconciliation

Paytm sends an S2S webhook on payment, but webhooks can be lost. Always pair with a poll loop on `/v3/order/status` (typical: 30s → 2m → 5m → give up at 30m).

```json
POST {BASE}/v3/order/status
{ "head": { "signature": "..." }, "body": { "mid": "YOUR_MID", "orderId": "QR_001" } }
```

---

## Worked example + frontend rendering

`scripts/frontend/qr.html` shows the full pattern (create QR → render → poll status → fulfill). Reference backends in all 4 languages handle the base64 prefix, the polling, and the webhook receiver.
