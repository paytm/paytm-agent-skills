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
