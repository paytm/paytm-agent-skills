---
name: paytm-subscriptions
description: >
  Paytm UPI Autopay / Native Subscription flow for recurring charges (monthly / weekly / yearly /
  daily mandates, SIPs). Covers `POST /subscription/create` with `requestType: NATIVE_SUBSCRIPTION`,
  the flat-body field placement (no `subscriptionDetails` wrapper), required `head.clientId` /
  `channelId` / `signature`, the `traceId` query param, retry / grace rules, default value choices,
  and the most common errors (4001 grace > frequency, custId sanitization, etc.). Load this skill
  for ANY recurring charge - "subscription", "monthly", "autopay", "mandate", "renew every…",
  "membership", "plan", "SIP". Do NOT load for one-time payments.
triggers:
  - "subscription/create"
  - "NATIVE_SUBSCRIPTION"
  - "NATIVE_MF_SIP"
  - "subscriptionFrequency"
  - "subscriptionPaymentMode"
  - "UPI Autopay"
  - "auto-debit"
  - "eMandate"
---

# Paytm Subscriptions (UPI Autopay / Native Subscription)

Recurring charges use a **different endpoint, different requestType, different field placement** from one-time Payment. Picking the wrong flow is the most expensive mistake in this skill — a "monthly subscription" generated as a one-time Payment charges once and never recurs.

Full field reference, error code table, worked example, charge / cancel / edit flows: `references/REFERENCE.md` — **read it before writing code**.

---

## Quick spec

| | Value |
|---|---|
| Endpoint (staging) | `POST {BASE}/subscription/create` |
| Endpoint (production) | `POST {BASE}/theia/api/v1/subscription/create` |
| Query params | `mid`, `orderId`, `traceId` (all required) |
| `requestType` | `"NATIVE_SUBSCRIPTION"` (or `"NATIVE_MF_SIP"` for SIPs) |
| `head` | `{ clientId, channelId, signature }` — all required |
| Subscription fields | **flat inside `body`** — no `subscriptionDetails` wrapper |

---

## Critical defaults (use these unless the user overrides)

- `subscriptionPaymentMode: "UNKNOWN"` — let user pick at consent.
- `txnAmount.value: "2.00"` — minimum for CC/DC mandates.
- `subscriptionGraceDays: "3"` — max for CC/DC, **AND must be < cycle length**. Drop / omit for daily or sub-3-day cycles, else Paytm returns `4001 Grace days cannot be greater than the frequency`.
- `subscriptionStartDate` = today.
- `subscriptionEnableRetry: "0"` with `subscriptionRetryCount` omitted.
- No `renewalAmount` field.
- Both `subscriptionFrequency` (number) AND `subscriptionFrequencyUnit` (period) required.

---

## Minimum body shape

```json
{
  "head": {
    "clientId": "C11",
    "channelId": "WEB",
    "signature": "<CHECKSUMHASH over JSON.stringify(body)>"
  },
  "body": {
    "requestType": "NATIVE_SUBSCRIPTION",
    "mid": "YOUR_MID",
    "websiteName": "WEBSTAGING",
    "orderId": "SUB_001",
    "callbackUrl": "https://yoursite.com/paytm/callback",
    "txnAmount": { "value": "2.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001" },

    "subscriptionAmountType": "FIX",
    "subscriptionFrequency": "1",
    "subscriptionFrequencyUnit": "MONTH",
    "subscriptionStartDate": "2026-05-09",
    "subscriptionExpiryDate": "2027-05-09",
    "subscriptionPaymentMode": "UNKNOWN",
    "subscriptionGraceDays": "3",
    "subscriptionEnableRetry": "0"
  }
}
```

`custId` must be sanitized to `[A-Za-z0-9_@-]` — special chars cause `4002`.

---

## After create: render JS Checkout for consent

The returned `txnToken` is consumed by JS Checkout exactly like a one-time payment, where the user approves the mandate. JS Checkout setup: load the `js-checkout` skill.

---

## After consent: charge / status / cancel

Recurring debit, status, edit, cancel operations are **out of scope for this skill** — refer to live Paytm docs and validate paths before implementing. `references/REFERENCE.md` covers them.

---

## Frequent errors

| Code | Meaning | Fix |
|---|---|---|
| `4001` | Grace days > frequency | Drop `subscriptionGraceDays` or set < cycle length |
| `4002` | Invalid custId / merchant param | Sanitize custId to `[A-Za-z0-9_@-]` |
| `5028` | Subscription start in past | `subscriptionStartDate` must be today or future |

Full table in `references/REFERENCE.md`.
