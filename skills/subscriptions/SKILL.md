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

> This skill is split across two files. `SKILL.md` (this file) gives the overview, defaults, and most common errors. `references/REFERENCE.md` contains the full field table, required fields per `subscriptionAmountType` (FIX vs VARIABLE), per-rail constraints (CC/DC vs UPI vs BANK_MANDATE), the IST date generation snippets per language, the charge / cancel / edit flows, and the full error code table — all NOT repeated here.
>
> **Do not generate any subscription code until you have read `references/REFERENCE.md`.**

---

## ❗ Endpoint path differs by environment — pick the right one

| Environment | Full endpoint URL |
|---|---|
| **Staging** | `POST https://securestage.paytmpayments.com/subscription/create?mid=...&orderId=...&traceId=...` |
| **Production** | `POST https://secure.paytmpayments.com/theia/api/v1/subscription/create?mid=...&orderId=...&traceId=...` |

Notice the **path prefix changes**: production has `/theia/api/v1/` before `/subscription/create`; staging does not. Using the staging path on production returns HTTP 404 / 501; using the production path on staging returns the same. This is unlike `/theia/api/v1/initiateTransaction` which uses the same path on both environments.

In code, derive the URL from `PAYTM_ENVIRONMENT`:

```js
const SUBSCRIPTION_URL =
  process.env.PAYTM_ENVIRONMENT === "production"
    ? `${PAYTM_PG_DOMAIN}/theia/api/v1/subscription/create`
    : `${PAYTM_PG_DOMAIN}/subscription/create`;
```

---

## Quick spec

| | Value |
|---|---|
| Endpoint (staging) | `POST {PAYTM_PG_DOMAIN}/subscription/create` |
| Endpoint (production) | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/subscription/create` |
| Query params | `mid`, `orderId`, `traceId` (all required) |
| `requestType` | `"NATIVE_SUBSCRIPTION"` (or `"NATIVE_MF_SIP"` for SIPs) |
| `head` | `{ clientId, channelId, signature }` — all required |
| Subscription fields | **flat inside `body`** — no `subscriptionDetails` wrapper |

---

## Critical defaults (use these unless the user overrides)

- `subscriptionPaymentMode: "UNKNOWN"` — let user pick at consent.
- `txnAmount.value: "2.00"` — minimum for CC/DC mandates.
- `subscriptionGraceDays`: **ALWAYS set this field — it is mandatory**, omitting it returns `"Grace days value is mandatory"`. The valid value depends on the cycle length and **must be < the cycle in days** (else `4001 Grace days cannot be greater than the frequency`):

  | Cycle | `subscriptionFrequency` + `Unit` | Cycle in days | Valid `subscriptionGraceDays` |
  |---|---|---|---|
  | Daily | `"1"`, `"DAY"` | 1 | `"0"` (only valid value) |
  | Every 2 days | `"2"`, `"DAY"` | 2 | `"0"` or `"1"` |
  | Weekly | `"7"`, `"DAY"` | 7 | `"0"` to `"6"` (default `"1"`) |
  | Monthly | `"1"`, `"MONTH"` | ~30 | `"0"` to `"3"` for CC/DC; default `"3"` |
  | Yearly | `"1"`, `"YEAR"` | 365 | `"0"` to `"3"`; default `"3"` |

- `subscriptionStartDate` = today **in IST** (`YYYY-MM-DD`). Generate at request time using an IST-aware helper (see `references/REFERENCE.md` § rule 17 for per-language snippets). **Do NOT use `new Date().toISOString().slice(0, 10)` in Node** — it returns UTC, and between 00:00–05:30 IST every night UTC is still "yesterday" → Paytm rejects with `5028 subscription start in past`.
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
