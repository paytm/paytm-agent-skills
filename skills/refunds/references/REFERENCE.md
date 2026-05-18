# Paytm Refunds - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full API surface for refunds: apply, status, webhooks, error handling, dispute relationship.

---

## API surface

| Endpoint | Purpose | Idempotent? |
|---|---|---|
| `POST {BASE}/refund/apply` | Initiate a full or partial refund | **Per `refId`** - reusing the same `refId` is safe and returns the existing refund |
| `POST {BASE}/v2/refund/status` | Check current state of a refund | Yes - read-only |
| Refund webhook (POST to your endpoint) | Push notification when state changes | At-least-once - dedupe on `(refId, status)` |

All API requests use:
```
head: { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" }
```
No `tokenType`, no `timestamp`. Mixing in fields from Payment Link head causes `227` checksum mismatch.

---

## Full request bodies

### `/refund/apply` - all fields

```json
{
  "head": { "signature": "..." },
  "body": {
    "mid": "YOUR_MID",
    "txnType": "REFUND",
    "orderId": "ORD_ABC123",
    "txnId": "<paytm-TXNID-from-original-payment>",
    "refId": "REF_001",
    "refundAmount": "50.00",
    "comments": "Optional audit message",
    "subWalletAmount": { "PAYTM_DIGITAL_CREDIT": "0.00" },
    "extraParamsMap": { "key": "value" }
  }
}
```

- `subWalletAmount` and `extraParamsMap` are optional - rarely needed. Skip unless you have a specific business reason.
- `txnType` MUST be `"REFUND"` - any other value is rejected.
- `txnId` is the **Paytm-issued** TXNID from the original payment response (not your `orderId`, not the bank's reference number).

### `/v2/refund/status` - all fields

```json
{
  "head": { "signature": "..." },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "refId": "REF_001",
    "readTimeOut": "30"
  }
}
```

`readTimeOut` is in seconds - how long Paytm will wait for downstream banking systems before returning. Default works for most cases.

---

## Response anatomy

```json
{
  "head": { "responseTimestamp": "1715424930000" },
  "body": {
    "resultInfo": {
      "resultStatus": "TXN_SUCCESS | PENDING | TXN_FAILURE",
      "resultCode": "601",
      "resultMsg": "Refund Successful"
    },
    "txnId": "...",
    "orderId": "ORD_ABC123",
    "refundId": "20240511153012800110168524598765432",
    "refundAmount": "50.00",
    "txnAmount": "100.00",
    "totalRefundAmount": "50.00",
    "txnTimestamp": "2024-05-11 15:30:12.0",
    "refundType": "ASYNC",
    "userCreditInitiateStatus": "PROCESSED | PENDING"
  }
}
```

Key fields to persist on your side:
- `refundId` - Paytm's id, use for status polling and reconciliation.
- `totalRefundAmount` - running total. **Compare this against `txnAmount` when allowing further partial refunds.**
- `userCreditInitiateStatus` - whether the credit has been initiated to the customer's bank. `PROCESSED` ≠ "money in customer's account" - the bank still has to settle.

---

## Refund states

```
INITIATED  -> PENDING  -> TXN_SUCCESS    (happy path)
                       \-> TXN_FAILURE   (rare - source instrument issue)
```

State transitions happen at Paytm + at the customer's bank. Pending states are normal:

| Time since refund | Typical state |
|---|---|
| 0-30 min | `PENDING` (Paytm queuing) |
| 30 min - 24 hours | `PENDING` (bank batching) |
| 24 hours - T+3 working days | `PENDING` (bank settlement window) |
| T+3 - T+7 working days | Should be `TXN_SUCCESS` by now |
| > T+7 working days | Escalate to Paytm support |

---

## Webhook payload for refunds

Same endpoint as payment webhooks (the `webhooks` skill covers transport/security/dedup). Body:

```json
{
  "head": { "signature": "..." },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "txnId": "...",
    "refundId": "...",
    "refId": "REF_001",
    "refundAmount": "50.00",
    "status": "TXN_SUCCESS | PENDING | TXN_FAILURE",
    "respCode": "...",
    "respMsg": "...",
    "txnType": "REFUND"
  }
}
```

Distinguishing from payment webhooks: check `body.txnType === "REFUND"` (or the presence of `refundId` / `refId`).

**Dedupe key for refunds:** `(refId, status)` - not `(orderId, status)`, because multiple refunds can exist for one order.

---

## Common error codes - extended

| Code / Message | Meaning | Action |
|---|---|---|
| `601` / `Refund Successful` | Money credited | Done |
| `617` / `Refund initiated successfully` | Accepted, processing | Wait for webhook / poll status |
| `INVALID_REFUND_AMOUNT` | `refundAmount > (txnAmount - cumulative_refunded)` | Track cumulative refunded server-side; reject locally before calling |
| `INVALID_TXN_STATE` | Original payment status not `TXN_SUCCESS` | Verify via `/v3/order/status` first; don't refund a `PENDING` payment |
| `DUPLICATE_REF_ID` | Same `refId` used in a previous attempt | Generate fresh `refId` (UUID without hyphens) |
| `REFUND_LIMIT_EXCEEDED` | Per-day or per-month refund limit hit | Contact Paytm KAM to raise the limit |
| `MERCHANT_NOT_ENABLED_FOR_REFUND` | Refunds not enabled on this MID | Enable from dashboard or contact KAM |
| `BANK_PENDING` | Bank settlement in progress | Wait, do not retry |
| `227` | Checksum mismatch | Same rules as JS Checkout - body bytes used to sign must equal bytes sent; MERCHANT_KEY quoted in `.env`; correct env |
| `501` | Paytm system error | Retry with **same `refId`** to ensure idempotency |

---

## Idempotency

Refunds are idempotent **per `refId`** on Paytm's side. Concrete behavior:

- First call with `refId: REF_001` -> Paytm processes, returns success / pending.
- Retry with same `refId: REF_001` -> Paytm returns the **same** existing refund's state, does NOT create a duplicate.
- Retry with a **different** `refId` for the same `orderId` + `refundAmount` -> Paytm creates a SECOND refund. This is how you get accidentally-double-refunds. Always retry with the same `refId`.

In code:
```js
async function refundWithRetry(orderId, txnId, amount, refId, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await callPaytmRefundApply({ orderId, txnId, refId, refundAmount: amount });
    } catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
// refId stays the same across retries - idempotent.
```

The reference backends include refund endpoints wrapped in the same `withIdempotency` cache used for payment creation - safe to retry.

---

## Partial refund tracking pattern

Server-side, keep a refund ledger per `orderId`:

```sql
CREATE TABLE refund_ledger (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  ref_id TEXT NOT NULL UNIQUE,
  refund_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL,           -- PENDING | TXN_SUCCESS | TXN_FAILURE
  paytm_refund_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON refund_ledger (order_id);
```

Before allowing a new partial refund, sum the `refund_amount` where `status IN ('PENDING', 'TXN_SUCCESS')` and ensure `sum + new_amount <= original_txn_amount`. Don't include `TXN_FAILURE` rows.

---

## Disputes / chargebacks (related but separate)

A **dispute** (also called chargeback) is when the customer raises an issue with their bank instead of asking you for a refund. Different flow:

- You receive a dispute notification via Paytm dashboard (and email).
- You have a deadline (typically 7-14 days) to respond with evidence: order details, delivery proof, terms acceptance, etc.
- Paytm forwards to the issuing bank, which decides.
- If you lose: the disputed amount is debited from your settlement balance. If you win: nothing changes.

Disputes are NOT done via the `/refund/apply` API - they're managed in the Paytm merchant dashboard. The skill bundle doesn't ship a dispute integration today; this section exists so you know the distinction when the user says "the customer disputed the charge."

---

## Settlement impact

When you refund, the refund amount is **debited from your next settlement**. This means:

1. If you've already been settled for the original payment, the refund reduces a future settlement (could even be net-negative if refunds > new sales that day).
2. Reconciliation: refunds appear in your settlement report with type `REFUND` and a negative amount.
3. T+1 / T+2 settlement merchants: refund initiated on day N reduces day N+1 / N+2 settlement.

Track this in finance reconciliation - the gross sales total ≠ settled amount when refunds are in play.

---

## Quick decision tree for refund debugging

```
Refund failing?
├─ Did /refund/apply return resultStatus: TXN_SUCCESS or PENDING?
│   ├─ No (TXN_FAILURE)
│   │   └─ Check resultCode -> table above -> matching fix
│   └─ Yes
│       └─ Is the refund still PENDING after T+7 working days?
│           ├─ Yes -> escalate to Paytm support with refundId + orderId + customer's bank
│           └─ No  -> normal bank-side delay, keep polling
└─ Original payment was never TXN_SUCCESS to begin with
    └─ resolve original payment state via /v3/order/status before retrying refund
```
