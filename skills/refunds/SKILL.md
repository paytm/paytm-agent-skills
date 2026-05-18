---
name: paytm-refunds
description: >
  Paytm refunds - full and partial refunds against a successful order. Covers `POST /refund/apply`,
  `POST /v2/refund/status`, refund webhooks, the `refId` uniqueness rule, partial-refund cumulative
  limit, PENDING-state behavior (bank delays up to T+7 working days), and the dispute/chargeback
  relationship. Load when the user asks about refunding a payment, partial refund, refund status,
  or "money back". Returns may take days; do NOT confuse refund PENDING with payment PENDING.
triggers:
  - "/refund/apply"
  - "/v2/refund/status"
  - "REFUND_STATUS"
  - "refId"
  - "refundAmount"
  - "refund webhook"
---

# Paytm Refunds

Refund a successful payment (full or partial). Refunds go through your funded settlement balance and credit the customer's source instrument (card / UPI VPA / bank account).

> This skill is split across two files. `SKILL.md` (this file) gives the pre-flight checklist + apply/status request shapes. `references/REFERENCE.md` contains the full API surface, refund state lifecycle (INITIATED → PENDING → SUCCESS / FAILURE), webhook payload distinction from payment events, idempotency-per-`refId` semantics, partial-refund tracking schema, dispute / chargeback distinction, settlement impact, and the extended error code table — all NOT repeated here.
>
> **Do not generate any refund code until you have read `references/REFERENCE.md`.**

---

## Quick decision

| User wants | Endpoint |
|---|---|
| Refund a successful payment | `POST {BASE}/refund/apply` |
| Check refund status | `POST {BASE}/v2/refund/status` |
| React to a refund state change in real time | Receive a refund webhook (see `webhooks` skill, refund event types in `REFERENCE.md`) |

Both API endpoints use the **JS Checkout head shape**: `head: { signature }` only — no `tokenType`, no `timestamp`. Mixing in the Payment Link head shape causes checksum mismatches.

---

## Pre-flight checklist (run before every `/refund/apply` call)

"Invalid refund request" is the most common refund error and it almost always traces to one of these. Verify each before generating the API call:

| Check | Why it fails if wrong |
|---|---|
| `txnId` is **Paytm's TXNID** from the original payment response, NOT your `orderId` and NOT the bank's reference number | Wrong-id triggers `INVALID_TXN_STATE` or generic "invalid refund request" |
| Original payment status is `TXN_SUCCESS` (confirmed via `/v3/order/status` server-side) | Refunding a `PENDING` or `TXN_FAILURE` payment returns "invalid request" |
| `refundAmount` is a **string with two decimals** (`"50.00"`, not `50` / `50.0` / `50.000`) | Wrong type / missing decimals rejected at validation |
| `refundAmount` + sum of any previous successful refunds for this `orderId` ≤ original `txnAmount` | Exceeding the cumulative cap returns "invalid refund amount" |
| `refId` is fresh (UUID without hyphens is safe). Same `refId` only on retry of the **exact same** refund attempt | Duplicate `refId` returns `DUPLICATE_REF_ID` |
| `head` shape is `{ signature }` ONLY — no `tokenType`, no `timestamp` | Mixing in fields from `/link/*` head causes checksum mismatch that looks like "invalid request" |
| `txnType: "REFUND"` is set in the body | Missing → request rejected as malformed |
| MID and Merchant Key match the **environment** the original payment was made in | Refunding a staging-MID payment with prod credentials → "invalid request" |

When the user reports "invalid refund request", walk through this table item by item before guessing.

## Critical rules

1. **`refId` is unique per refund attempt.** Generate fresh per call. Duplicate `refId` returns `Duplicate refId` — a retry of the same refund needs a new `refId`.

2. **Cumulative refund ≤ original `txnAmount`.** Partial refunds are allowed (e.g. refund ₹30 of a ₹100 order), but the **running total** across all refunds for an `orderId` cannot exceed the original. Track this server-side. Paytm rejects `refundAmount > remaining` with an `INVALID_REFUND_AMOUNT` style error.

3. **Refund can stay `PENDING` up to T+7 working days.** Bank-side delay. Do NOT auto-retry while pending — poll `/v2/refund/status` periodically or wait for the refund webhook.

4. **Don't refund a payment whose status hasn't been confirmed via `/v3/order/status`.** Refunding against a payment that's still `PENDING` returns `INVALID_TXN_STATE`. Always verify first.

5. **The `txnId`** in the refund body must be Paytm's `TXNID` from the original payment response — NOT your `orderId`, NOT the bank's reference number.

---

## Apply a refund

```
POST {BASE}/refund/apply
Content-Type: application/json
```

```json
{
  "head": { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" },
  "body": {
    "mid": "YOUR_MID",
    "txnType": "REFUND",
    "orderId": "ORD_ABC123",
    "txnId": "20240511112233800110168524301234567",
    "refId": "REF_001",
    "refundAmount": "50.00",
    "comments": "Customer requested refund - order cancelled"
  }
}
```

**Field rules:**
- `refundAmount` is a **string with two decimals** (same as `txnAmount` everywhere else). `50`, `50.0`, `50.000` break.
- `comments` is optional but shows up in your reconciliation reports; use a short audit message.
- `txnType: "REFUND"` is mandatory — without it the request is rejected as malformed.

**Response shape:**
```json
{
  "head": { "responseTimestamp": "..." },
  "body": {
    "resultInfo": {
      "resultStatus": "TXN_SUCCESS | PENDING | TXN_FAILURE",
      "resultCode": "...",
      "resultMsg": "..."
    },
    "txnId": "<original-paytm-txnId>",
    "orderId": "ORD_ABC123",
    "refundId": "<paytm-refundId>",
    "refundAmount": "50.00",
    "txnTimestamp": "..."
  }
}
```

`refundId` is Paytm's identifier — store this in your DB alongside your `refId` for reconciliation.

---

## Check refund status

```json
POST {BASE}/v2/refund/status

{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "refId": "REF_001"
  }
}
```

Response uses the same `resultInfo.resultStatus` shape. `TXN_SUCCESS` = money back at customer; `PENDING` = bank still processing; `TXN_FAILURE` = refund rejected (rare, usually wallet/bank issue).

---

## Polling strategy

If you're not consuming refund webhooks, poll with exponential backoff: 30 s -> 2 m -> 5 m -> 15 m -> 1 h -> stop at T+7 days. Webhooks are preferred — see the `webhooks` skill.

---

## Common error codes

| Code | Meaning | Fix |
|---|---|---|
| `501` | Paytm system error | Retry — refunds are NOT idempotent on Paytm's side unless you reuse `refId`. Treat the same `refId` retry as safe. |
| `INVALID_REFUND_AMOUNT` | `refundAmount` > remaining refundable balance | Track cumulative refunded amount server-side, reject locally before calling |
| `INVALID_TXN_STATE` | Original payment isn't in a refundable state | Verify with `/v3/order/status` first |
| `DUPLICATE_REF_ID` | Same `refId` reused | Generate fresh `refId` per refund attempt (UUID without hyphens is safe) |
| `REFUND_LIMIT_EXCEEDED` | Per-day refund limit hit | Contact Paytm support to raise the limit |

Full table + per-symptom debugging: `references/REFERENCE.md`.

---

## When to load related skills

- **Verifying the original payment succeeded** before refunding → `js-checkout` (Step 5: Transaction Status).
- **Receiving refund webhooks** → `webhooks` skill.
- **Refund stuck PENDING for > 7 days** → `troubleshooting` skill.
- **Disputes / chargebacks** (different flow, not a refund) → not yet a skill; raise via dashboard.
