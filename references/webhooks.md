# Paytm Webhooks (S2S Notifications)

The browser callback is unreliable; webhooks are the authoritative push channel from Paytm to your server. Configure once on the dashboard, then handle events idempotently.

---

## Configuration

Dashboard → **Webhook Settings** → add a URL per event group:

| Group | Events |
|---|---|
| Payment | `TXN_SUCCESS`, `TXN_FAILURE`, `PENDING` resolution |
| Refund | `REFUND_SUCCESS`, `REFUND_FAILURE`, `REFUND_PENDING_BANK_RESPONSE` |
| Subscription | `SUBSCRIPTION_*` (see `references/subscriptions.md`) |
| Tokenization | `TOKEN_CREATED`, `TOKEN_DELETED`, `TOKEN_UPDATED` |
| Payment Link | Per-link payment events |
| Dispute | `DISPUTE_RAISED`, `DISPUTE_RESOLVED` |

Requirements:
- HTTPS, valid TLS cert (no self-signed)
- Public DNS (no IP-only / localhost / `.local`)
- Respond `2xx` within 10s (Paytm timeout)
- Same MID can have **different URLs per group**

---

## Request shape

```
POST <your webhook url>
Content-Type: application/json
X-Paytm-Signature: <signature>     ← some accounts only
```

Body for a payment event:

```json
{
  "head": {
    "responseTimestamp": "1700000000000",
    "version": "v1",
    "signature": "<CHECKSUMHASH>"
  },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "txnId": "...",
    "txnAmount": "499.00",
    "currency": "INR",
    "status": "TXN_SUCCESS",
    "respCode": "01",
    "respMsg": "Txn Success",
    "paymentMode": "UPI",
    "bankTxnId": "...",
    "gatewayName": "...",
    "txnDate": "2025-04-28 12:00:00.0",
    "extendInfo": { "mercUnqRef": "..." }
  }
}
```

Field names here are **camelCase** (different from the browser callback, which is UPPERCASE). Don't share parsing code between the two.

---

## Verifying the signature

```python
# Python
import json
from paytmchecksum import PaytmChecksum

raw_body = request.get_data(as_text=True)          # raw bytes — DO NOT re-serialize
parsed   = json.loads(raw_body)
signature = parsed["head"]["signature"]
body_str  = json.dumps(parsed["body"], separators=(",", ":"))   # see note below
ok = PaytmChecksum.verifySignature(body_str, MERCHANT_KEY, signature)
```

```javascript
// Node
const raw = req.rawBody;                            // configure express.json({ verify: ... })
const parsed = JSON.parse(raw);
const ok = PaytmChecksum.verifySignature(
  JSON.stringify(parsed.body),
  MERCHANT_KEY,
  parsed.head.signature
);
```

```java
// Spring
String raw = StreamUtils.copyToString(request.getInputStream(), StandardCharsets.UTF_8);
JsonNode root = mapper.readTree(raw);
String signature = root.path("head").path("signature").asText();
String bodyStr = mapper.writeValueAsString(root.path("body"));
boolean ok = PaytmChecksum.verifySignature(bodyStr, MERCHANT_KEY, signature);
```

> **Serialization gotcha:** Paytm signs the bytes of `body` *as Paytm serialized them*. Re-serializing in your language can change key order or whitespace and break the signature.
> **Safest approach:** parse minimally, extract the *substring* of the raw body that corresponds to `body`, and verify against that. If you can't, use a JSON library configured to preserve key order and not pretty-print.

---

## Reliability semantics

| | Behavior |
|---|---|
| **Delivery** | At-least-once (you will see duplicates) |
| **Order** | Not guaranteed (a `REFUND_SUCCESS` can arrive before the corresponding `TXN_SUCCESS` if you replay) |
| **Retries** | Paytm retries on non-`2xx` for ~24h with exponential backoff (typical: 1m, 5m, 15m, 1h, 3h, 6h, 12h) |
| **Timeout** | 10s — return `2xx` *fast*, queue heavy work |
| **Dead-letter** | After ~24h Paytm gives up; reconcile via daily Settlement Report |

**Always idempotent:** key your handler off `(orderId, status)` or `(orderId, refId, status)` and a "have I already processed this?" check.

---

## Recommended handler shape

```
1. Read raw body
2. Verify head.signature against body bytes — reject 401 if invalid
3. Parse minimal fields needed for routing
4. Look up local order/refund/subscription record
5. Idempotency check: have we already applied this state transition?
6. Persist event (raw body) for audit
7. Apply the state transition (fulfill order, mark refund, etc.)
8. Return 200 OK with empty body
```

Heavy lifting (emails, accounting, reconciliation) → push to a queue from step 6, return 200 immediately.

---

## Event reference (most common)

| Event | When | Key fields |
|---|---|---|
| `TXN_SUCCESS` | Final success after all rails confirm | `orderId`, `txnId`, `txnAmount`, `paymentMode`, `bankTxnId` |
| `TXN_FAILURE` | Final failure | + `respCode`, `respMsg` |
| `PENDING_TO_SUCCESS` | A previously PENDING txn cleared | Same as `TXN_SUCCESS` |
| `PENDING_TO_FAILURE` | A previously PENDING txn rejected | Same as `TXN_FAILURE` |
| `REFUND_SUCCESS` | Bank confirmed refund | `refId`, `refundId`, `refundAmount` |
| `REFUND_FAILURE` | Bank rejected refund | + `respCode` |
| `SUBSCRIPTION_ACTIVE` | Mandate authorized | `subsId`, `subscriptionStatus` |
| `SUBSCRIPTION_RENEWAL_SUCCESS` | Recurring debit succeeded | `subsId`, `orderId`, `txnId` |
| `TOKEN_CREATED` | New saved card token | `tokenReferenceId`, `custId` |

---

## Pitfalls

1. **Don't trust webhook body without verifying signature.** Easy attack: spoofed POST flips an order to paid.
2. **Don't fail the request on processing errors.** If your DB is down, return `5xx` so Paytm retries — but log loudly. Returning `200` discards the event.
3. **Duplicates are normal.** If your handler isn't idempotent, you'll double-fulfill orders.
4. **Out-of-order events are normal.** A `REFUND_SUCCESS` for an order whose payment webhook is delayed must not crash — store and resolve.
5. **Whitelist Paytm's egress IPs** at your firewall (request the current list from Paytm support — it changes).
6. **Don't share the webhook URL across MIDs.** Paytm signs with the per-MID key; verification will fail intermittently.
7. **Test with the dashboard's "Send test event"** before going live — it exercises the exact signature path.
8. **Reconcile daily.** Webhooks can be lost during Paytm-side incidents; the Settlement Report is the truth-of-last-resort.
