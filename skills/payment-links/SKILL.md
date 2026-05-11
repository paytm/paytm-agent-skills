---
name: paytm-payment-links
description: >
  Paytm Payment Links - server-only flow that returns a `shortUrl` you share via SMS / WhatsApp /
  email. Paytm hosts the checkout page, so there is NO frontend / JS Checkout work. Covers
  `/link/create`, `/link/fetch`, `/link/update`, `/link/resendNotification`, `/link/expire`, and
  `/link/fetchTransaction` for reconciliation. Includes the MID-specific quirks that bite hardest:
  `linkId` as JSON number (NOT string), `linkName` charset (alphanumerics ONLY, no spaces),
  dual-shape `isActive` vs `linkStatus` responses, dual-shape `SUCCESS` vs `TXN_SUCCESS` order
  status, and the AES head shape vs the order-status API. Load this skill for "shareable link",
  "invoice link", "payment link via SMS / WhatsApp / email".
triggers:
  - "/link/create"
  - "/link/fetch"
  - "/link/fetchTransaction"
  - "/link/expire"
  - "/link/resendNotification"
  - "linkId"
  - "shortUrl"
---

# Paytm Payment Links

A **server-only** flow: you POST `/link/create`, get back a `shortUrl`, share it. Paytm hosts the checkout page — no JS Checkout, no merchant `.js`, no frontend wiring needed.

Full pitfall list (20+), error code table, fetch-transaction reconciliation, and worked examples: `references/REFERENCE.md`.

---

## Endpoint family

| Operation | Endpoint |
|---|---|
| Create | `POST {BASE}/link/create` |
| Fetch | `POST {BASE}/link/fetch` |
| Update | `POST {BASE}/link/update` |
| Resend notification | `POST {BASE}/link/resendNotification` (NOT `/link/resend`) |
| Expire | `POST {BASE}/link/expire` |
| Fetch transactions (reconciliation) | `POST {BASE}/link/fetchTransaction` |

All `/link/*` endpoints share the **same head shape** — different from `/v3/order/status`:

```json
{ "head": { "tokenType": "AES", "signature": "<sig>", "timestamp": "..." }, "body": { ... } }
```

---

## ❗ The five quirks that keep biting

1. **`linkId` is a JSON number, NOT a string.** Wrong: `"linkId": "12345"`. Right: `"linkId": 12345`. Wrong type returns `"invalid link id"`.

2. **`linkName` charset is alphanumerics ONLY — no spaces.** Several MIDs reject space as a special character despite the docs, returning `5007`. **`linkDescription` allows alphanumerics + spaces.** Sanitize each with its own regex on the server. Both ≥ 3 chars.

3. **Status fields are dual-shape.** Create / fetch responses return *either* `linkStatus: "ACTIVE"` (string) *or* `isActive: true` (boolean) depending on MID. Read defensively:
   ```js
   const active = body.linkStatus === "ACTIVE" || body.isActive === true;
   ```

4. **`/link/fetchTransaction` `orderStatus` is dual-shape too.** Match BOTH `"SUCCESS"` AND `"TXN_SUCCESS"` for paid orders — hard-coding only `"TXN_SUCCESS"` silently misses every paid link on MIDs that return `"SUCCESS"`.

5. **Reconcile via `/link/fetchTransaction`, NOT `/v3/order/status`.** They're different endpoints with different head shapes. `/v3/order/status` is for JS-Checkout payments only.

---

## Minimum create body

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkType": "FIXED",
    "linkDescription": "Order 1234",
    "linkName": "Order1234",
    "amount": "100.00",
    "currency": "INR",
    "expiryDate": "2026-06-09",
    "customerContact": {
      "customerName": "Buyer",
      "customerEmail": "buyer@example.com",
      "customerPhone": "9999999999"
    },
    "sendSms": true,
    "sendEmail": true
  }
}
```

`linkType` values: `FIXED` (fixed amount, single use), `REUSABLE` (fixed amount, multi use), `OPEN` (customer enters amount).

---

## Reconciliation pattern

After sharing the link, poll `/link/fetchTransaction` periodically (or on-demand from your dashboard) — Paytm doesn't push events. Match dual-shape status:

```js
const paid = txn.orderStatus === "SUCCESS" || txn.orderStatus === "TXN_SUCCESS";
```

---

## Common error codes

| Code | Meaning |
|---|---|
| `5007` | Invalid character in `linkName` (most often a space — strip them) |
| `5021` | Duplicate `merchantOrderId` (use a fresh one per call) |
| `5028` | Invalid expiry date (must be future, ISO format) |
| `5082` | Wrong MID/key combination |

Full table + per-symptom fixes: `references/REFERENCE.md`.
