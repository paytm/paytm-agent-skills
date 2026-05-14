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

> This skill is split across two files. `SKILL.md` (this file) gives the request/response shape and the bulletproof error parser. `references/REFERENCE.md` contains the full reconciliation flow, the polling backoff table, the QR-vs-VPA-collect distinction, the printed-QR static-amount variant, and the full error code table — all NOT repeated here.
>
> **Do not generate any QR code until you have read `references/REFERENCE.md`.**

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

Paytm error responses for QR (and the rest of the API) **always carry the failure reason inside `body.resultInfo`**, even when the top-level HTTP body or your client library makes it look empty. If you see something like `{}`, `"QR generation failed: {}"`, or `"undefined: undefined"` on the frontend, the parsing is reaching for the wrong field.

### Bulletproof error extractor (use this verbatim)

Never directly interpolate `info.resultCode` / `info.resultMsg` into a string without first checking they exist. That's how `"undefined: undefined"` ends up in production. Use this defensive pattern:

```js
const r = await fetch(`${PAYTM_PG_DOMAIN}/paymentservices/qr/create`, { ... });
const json = await r.json();
console.log("[paytm qr] full response:", JSON.stringify(json, null, 2));

// `resultInfo` lives in different places across Paytm endpoints. Check all the spots.
const info =
  json?.body?.resultInfo ||      // most endpoints
  json?.resultInfo ||            // some legacy responses
  json?.head?.resultInfo;        // very rare

const code = info?.resultCode ?? info?.code ?? "UNKNOWN";
const msg  = info?.resultMsg  ?? info?.message ?? info?.resultMessage ?? JSON.stringify(json);

if (info?.resultStatus !== "S" && info?.resultStatus !== "TXN_SUCCESS") {
  throw new Error(`Paytm QR failed (${code}): ${msg}`);
}
```

Three rules baked in:
1. Look for `resultInfo` in **multiple locations** (some Paytm endpoints nest it under `head` or omit `body`).
2. Use `??` (nullish coalescing), never `||` for code/msg lookups — `||` on an empty string falls through to "UNKNOWN" which loses real info.
3. Fall back to `JSON.stringify(json)` for `msg` so the user always sees the raw response when nothing else matches. Never report literal `"undefined"`.

Never report `"{}"`, `"empty body"`, or `"undefined: undefined"` to the user — those are tells that the parser is broken.

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
