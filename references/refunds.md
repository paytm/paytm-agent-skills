# Paytm Refunds — Deep Dive

Refunds are server-to-server, asynchronous, idempotent on `refId`, and reconciled via webhook + status API. Same checksum scheme as Initiate Transaction.

---

## Lifecycle

```
apply → ACCEPTED (instant) → PENDING (Paytm processing) → SUCCESS / FAILURE
                                               │
                                               ├─ PENDING can persist T+1 to T+7 working days
                                               └─ Reconcile via /v2/refund/status or webhook
```

Once `apply` returns `ACCEPTED` you have a Paytm-side refund record — never re-call apply for the same `refId` (idempotent) and never reuse a `refId` for a different refund (logical clash).

---

## Initiate Refund

```
POST {pgDomain}/refund/apply
Content-Type: application/json
```

```json
{
  "head": {
    "tokenType": "AES",
    "signature": "<CHECKSUMHASH over JSON.stringify(body)>"
  },
  "body": {
    "mid": "YOUR_MID",
    "txnType": "REFUND",
    "orderId": "ORD_ABC123",
    "txnId": "<paytm TXNID from original payment>",
    "refId": "REF_ABC123_001",
    "refundAmount": "1.00"
  }
}
```

| Field | Notes |
|---|---|
| `txnType` | Always `"REFUND"` |
| `orderId` | The original payment's orderId |
| `txnId` | Paytm's TXNID from the successful payment (not your orderId) |
| `refId` | **Your** unique refund reference. `[A-Za-z0-9_@-]+`, ≤ 50 chars. Used for idempotency and as the lookup key |
| `refundAmount` | String, two decimals. Cumulative refunds ≤ original `txnAmount` |
| `head.tokenType` | `"AES"` for refund APIs (per Paytm docs); some integrations omit and it still works |

### Optional fields

| Field | Use |
|---|---|
| `comments` | Free-text reason — visible in dashboard |
| `extendInfo.mercUnqRefId` | Echoed back in webhook; reconciliation tag |
| `subwalletAmount` | For Paytm Wallet sub-wallet refunds (food/fuel) |
| `extraParamsMap` | Per-mode metadata Paytm support may ask for |

### Response (immediate)

```json
{
  "head": { "responseTimestamp": "...", "version": "v1", "signature": "..." },
  "body": {
    "txnId": "...",
    "orderId": "ORD_ABC123",
    "mid": "YOUR_MID",
    "refId": "REF_ABC123_001",
    "refundId": "<paytm-issued refundId>",
    "txnAmount": "1.00",
    "refundAmount": "1.00",
    "txnType": "REFUND",
    "resultInfo": {
      "resultStatus": "PENDING",
      "resultCode": "501",
      "resultMsg": "Refund Initiated"
    }
  }
}
```

`resultStatus` here is **acceptance status**, not final. Possible values:

| `resultStatus` | Meaning |
|---|---|
| `TXN_SUCCESS` | Refund fully completed (instant for some methods) |
| `PENDING` | Accepted; awaiting bank — poll `/refund/status` or wait for webhook |
| `TXN_FAILURE` | Rejected synchronously — read `resultMsg` |

---

## Refund Status

```
POST {pgDomain}/refund/status
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "refId": "REF_ABC123_001"
  }
}
```

Response mirrors the apply response with the **current** `resultInfo.resultStatus`. Treat this as the authoritative record alongside the webhook.

### Polling cadence (recommended)

```
0s → 30s → 2m → 10m → 1h → 6h → daily for 7 days → mark stuck for ops
```

Most refunds resolve within minutes; net-banking refunds can take T+5 working days.

---

## Partial refunds

Allowed on most payment modes:

- Multiple `apply` calls for the **same orderId**, each with a **different `refId`**.
- Cumulative `refundAmount` across all refunds ≤ original `txnAmount`.
- Each partial refund has its own lifecycle and `refundId`.

```
Original txn: ₹1000
  refId REF_001 → refundAmount 300 → SUCCESS
  refId REF_002 → refundAmount 400 → PENDING
  refId REF_003 → refundAmount 400 → REJECTED (would exceed 1000)
```

---

## Refund webhook

If configured (dashboard → Webhook Settings → "Refund"), Paytm POSTs status changes:

```
POST <your-refund-webhook-url>
Content-Type: application/json
```

Body shape ≈ refund status response. Verify the signature in the `head` before trusting:

```
PaytmChecksum.verifySignature(JSON.stringify(body), MERCHANT_KEY, head.signature)
```

Webhook events:
- `REFUND_SUCCESS`
- `REFUND_FAILURE`
- `REFUND_PENDING_BANK_RESPONSE`

Webhook is the recommended source of truth for fulfillment / accounting reversal — the polling API is a fallback when you miss a webhook.

---

## Common refund errors

| `resultCode` | Meaning | Fix |
|---|---|---|
| `501` | Initiated (not an error — `PENDING`) | Wait/poll |
| `601` | Refund amount > available balance for txn | Reduce amount or check prior partial refunds |
| `602` | Duplicate `refId` | Use a fresh `refId` |
| `603` | Refund not allowed for this txn (e.g. test mode mismatch, txn too old) | Check txn age / dashboard limits |
| `605` | Original txn not found | Wrong `txnId` / `orderId` combination |
| `617` | Refund window closed (typically 180 days) | Out of policy — handle out-of-band |
| `334` | Already refunded | Check status first |

---

## Implementation notes

- **Build on top of `scripts/backend-{node,spring,python}`** by adding a `refund.{js,java,py}` module that mirrors `initiateTransaction` — same checksum, same `head/body` envelope, different endpoint and body shape.
- **Persist your `refId` ↔ `refundId` mapping** before calling apply. If the network drops mid-call, you can safely call `/refund/status` with `refId` and resume.
- **Never refund from a callback handler** — the browser callback is unreliable. Trigger refunds from authoritative server state (e.g. order cancel, dispute resolution).
- **Reconcile daily** with the dashboard's Settlement Report — webhooks can be missed, polling can lag.
