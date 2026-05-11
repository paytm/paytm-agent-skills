---
name: paytm-refunds
description: >
  Paytm refunds API - full and partial refunds against a successful order. Covers `POST /refund/apply`,
  refund status polling, the `refId` uniqueness rule, partial-refund cumulative limit, and the
  PENDING-state behavior (bank delays up to T+7). Load when the user asks about refunding a payment,
  partial refund, refund status, or "money back". Returns may take days; do NOT confuse refund PENDING
  with payment PENDING.
triggers:
  - "/refund/apply"
  - "/refund/status"
  - "refId"
  - "refundAmount"
status: stub
---

# Paytm Refunds

> **Status: stub.** This skill is being expanded in the next product-depth pass. The core API contract below is correct; advanced flows (disputes, chargebacks, settlement adjustments) will land in the next iteration.

Full refund flow + dispute handling will live here. Until then, the rules below + the reference backends cover the common case.

---

## Quick contract

| Operation | Endpoint |
|---|---|
| Initiate refund | `POST {BASE}/refund/apply` |
| Check refund status | `POST {BASE}/refund/status` |

Both use the JS Checkout head shape: `head: { signature }` (no `tokenType`).

---

## Rules

- **`refId` is unique per refund attempt.** Generate fresh per call. A duplicate `refId` returns `Duplicate refId`.
- **Partial refunds allowed**, but the **cumulative refunded amount must not exceed the original `txnAmount`**. Track the running total server-side.
- **Refund can stay `PENDING` for up to T+7 working days** depending on the bank. Don't auto-retry if pending — poll status periodically.

---

## Minimum apply body

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "txnType": "REFUND",
    "orderId": "ORD_ABC123",
    "txnId": "<paytm-txnId-from-original-payment>",
    "refId": "REF_001",
    "refundAmount": "50.00",
    "comments": "Customer requested refund"
  }
}
```

`refundAmount` is a string with two decimals (same rule as `txnAmount`).

---

## Status response shape

```json
{
  "body": {
    "resultInfo": {
      "resultStatus": "SUCCESS | PENDING | FAILURE",
      "resultCode": "...",
      "resultMsg": "..."
    },
    "refundId": "...",
    "refundAmount": "..."
  }
}
```

Don't fulfill anything on `PENDING` — wait for `SUCCESS`.

---

## When to load related skills

- **Verifying the original payment succeeded** before refunding → `js-checkout` (Step 5).
- **Reconciling refund webhooks** → `webhooks` skill.
- **Debugging "refund stuck pending"** → `troubleshooting` skill.
