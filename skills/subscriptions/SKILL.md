---
name: paytm-subscriptions
description: >
  Paytm UPI Autopay / Native Subscription flow for recurring charges (monthly / weekly / yearly /
  daily mandates, SIPs). Covers `POST /subscription/create` with `requestType: NATIVE_SUBSCRIPTION`,
  the flat-body field placement (no `subscriptionDetails` wrapper), required `head.clientId` /
  `channelId` / `signature`, the `traceId` query param, retry / grace rules, default value choices,
  and the most common errors (4001 grace > frequency, custId sanitization, etc.). Also covers the
  full post-consent recurring lifecycle (`subscription/checkStatus`, `renew`, `preNotify`,
  `cancel`, `v3/order/status`), the `/theia/` vs non-`/theia/` host split, and subscription webhook
  events (`SUBSCRIPTION_DEBIT` / `SUBSCRIPTION_CANCEL`) — see `references/recurring-lifecycle.md`.
  Load this skill for ANY recurring charge - "subscription", "monthly", "autopay", "mandate",
  "renew every…", "membership", "plan", "SIP". Do NOT load for one-time payments.
triggers:
  - "subscription/create"
  - "subscription/checkStatus"
  - "subscription/renew"
  - "subscription/preNotify"
  - "subscription/cancel"
  - "v3/order/status"
  - "NATIVE_SUBSCRIPTION"
  - "NATIVE_MF_SIP"
  - "subscriptionFrequency"
  - "subscriptionPaymentMode"
  - "subscriptionId"
  - "subsId"
  - "SUBS_ID"
  - "subStatus"
  - "SUBSCRIPTION_DEBIT"
  - "SUBSCRIPTION_CANCEL"
  - "pre-notification"
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

> ⚠️ **`create` is the ONLY endpoint on `/theia/`.** All the post-consent management APIs (`checkStatus`, `renew`, `preNotify`, `preNotify/status`, `cancel`, `v3/order/status`) live on the **non-`/theia/` host on BOTH environments** — `{PG_DOMAIN}/subscription/<op>`. Reusing the `create` base URL for management calls on production returns 404 (`SVE-003`) or an HTML error page. This host split is the single biggest time-sink reported by integrators — see `references/recurring-lifecycle.md` for the full per-endpoint host table.

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
  <!-- Weekly cadence is standardized as "7" + "DAY" across this skill (REFERENCE.md too). "1" + "WEEK" is equivalent only if your MID has the WEEK unit enabled — prefer "7"+"DAY" for portability. -->
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

`custId` must be sanitized to **`[A-Za-z0-9_]`** (authoritative — strip everything else) — special chars cause `4002`. Although Paytm prose lists `@ ! $ .` as "accepted", support varies by MID; normalizing to `[A-Za-z0-9_]` is the only reliable cross-MID rule. Persist the sanitized form.

---

## After create: render JS Checkout for consent

The returned `txnToken` is consumed by JS Checkout exactly like a one-time payment, where the user approves the mandate. JS Checkout setup: load the `js-checkout` skill.

---

## After consent: the recurring lifecycle (REQUIRED for a real integration)

Creation alone is not a working subscription. A production plugin must also detect cancellations, charge renewals, send pre-debit notifications, and verify callbacks. **Full request/response shapes, per-endpoint `head` requirements, and the correct hosts are in [`references/recurring-lifecycle.md`](references/recurring-lifecycle.md).** The essentials:

| Operation | Endpoint (host = `{PG_DOMAIN}`, non-`/theia/`, both envs) | Purpose |
|---|---|---|
| Status check | `POST /subscription/checkStatus` | Detect cancel / expiry — the only reliable signal |
| Recurring debit | `POST /subscription/renew` | Charge one cycle (you schedule it) |
| Pre-debit notify | `POST /subscription/preNotify` (+ `/preNotify/status`) | NPCI 24h notice — **you must call this; Paytm does not auto-handle it** |
| Cancel | `POST /subscription/cancel` | Terminate a mandate |
| Per-charge status | `POST /v3/order/status` | Did this specific debit succeed |

**Three gotchas worth memorizing:**

1. 🚨 **A cancelled mandate returns `status: "REJECT"`.** Only `subStatus` (`MERCHANT_CANCELLED` / `USER_CANCELLED`) reveals it was a cancellation — mapping on `status` alone wrongly reads it as `TXN_FAILURE`. **Read `subStatus` first.**
2. **The mandate ID has three names:** `subscriptionId` (create response) → `subsId` (checkStatus / order/status) → `SUBS_ID` (redirect/webhook POST). Read all three defensively.
3. **`SUBSCRIPTION_CANCEL` webhook may never fire on your MID.** `checkStatus` polling is the dependable fallback for cancellation detection — don't rely on the webhook alone.

---

## Frequent errors

| Code | Meaning | Fix |
|---|---|---|
| `4001` | Grace days > frequency | Drop `subscriptionGraceDays` or set < cycle length |
| `4002` | Invalid custId / merchant param | Sanitize custId to `[A-Za-z0-9_@-]` |
| `5028` | Subscription start in past | `subscriptionStartDate` must be today or future |

Full table in `references/REFERENCE.md`.
