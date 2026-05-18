# Paytm S2S Webhooks - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full receiver contract: event types, retry/backoff behavior, raw-body handling per language, idempotency patterns, operational checklist.

---

## Event types

Paytm delivers webhooks for any state change worth fulfilling against. Distinguish by the `body.txnType` or by the presence of refund-only fields (`refundId`, `refId`).

| Event | `body.txnType` | `body.status` values | Notes |
|---|---|---|---|
| Payment success | `"SALE"` (or absent) | `TXN_SUCCESS` | Fulfil order, send receipt |
| Payment failure | `"SALE"` | `TXN_FAILURE` | Surface failure to customer, allow retry |
| Payment pending | `"SALE"` | `PENDING` | Don't fulfil yet; pair with `/v3/order/status` poll |
| Refund success | `"REFUND"` | `TXN_SUCCESS` | Update refund ledger, notify customer |
| Refund pending | `"REFUND"` | `PENDING` | Bank still processing - normal up to T+7 |
| Refund failure | `"REFUND"` | `TXN_FAILURE` | Rare - source instrument issue. Escalate. |
| Subscription mandate created | `"SUBSCRIPTION_INIT"` | `TXN_SUCCESS` | Mandate active, schedule first debit |
| Subscription debit | `"SUBSCRIPTION_DEBIT"` | `TXN_SUCCESS` / `TXN_FAILURE` | Recurring charge result |
| Subscription cancelled | `"SUBSCRIPTION_CANCEL"` | `TXN_SUCCESS` | Disable recurring locally |
| QR payment | `"QR_PAYMENT"` | `TXN_SUCCESS` / `TXN_FAILURE` | Same shape as SALE but originating from a QR scan |

If `txnType` is missing, treat it as `"SALE"`. The reference backends already do this.

---

## Body shape (canonical)

```json
{
  "head": {
    "signature": "<CHECKSUMHASH over the raw body bytes>"
  },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "ORD_ABC123",
    "txnId": "20240511112233800110168524301234567",
    "txnAmount": "100.00",
    "currency": "INR",
    "status": "TXN_SUCCESS | TXN_FAILURE | PENDING",
    "respCode": "01",
    "respMsg": "Txn Success",
    "txnType": "SALE | REFUND | SUBSCRIPTION_INIT | ...",
    "paymentMode": "UPI | CARD | NET_BANKING | EMI",
    "bankTxnId": "...",
    "bankName": "...",
    "txnDate": "2024-05-11 15:30:12.0",

    "refundId": "...",        // present only for REFUND events
    "refId": "REF_001",       // present only for REFUND events
    "subscriptionId": "..."   // present only for SUBSCRIPTION_* events
  }
}
```

All values are strings (including numerics) - that's how Paytm serializes them. Don't assume numeric types.

---

## Retry behavior

Paytm retries on **any non-2xx response** (or timeout > 30 s) with the following schedule:

| Attempt | Delay from previous |
|---|---|
| 1 | (initial delivery) |
| 2 | ~1 minute |
| 3 | ~5 minutes |
| 4 | ~30 minutes |
| 5 | ~2 hours |
| 6 | ~6 hours |
| 7 | ~24 hours |
| ...stops after ~10 attempts over ~7 days |

After Paytm gives up, the event is lost. **Pair webhook delivery with polling on `/v3/order/status` or `/v2/refund/status`** as a safety net for events you might have missed.

Your endpoint should:
- Return **200** within 30 s for success OR for a duplicate event already processed.
- Return **401** when signature verification fails (Paytm will NOT retry 4xx - this is the only case where you intentionally don't want a retry).
- Return **5xx** for transient errors (DB down, queue full) - Paytm retries.

Returning 200 for **everything** (even processing errors) is a common bug - your DB write fails silently, the event is gone, and reconciliation finds an unfulfilled order three days later.

---

## Raw-body extraction per language

Paytm's signature is computed over the **exact bytes** of the request body. Any reformatting between receive and verify breaks it.

### Node.js (Express)

```js
import express from "express";
import PaytmChecksum from "paytmchecksum";

const app = express();

// CRITICAL: raw body BEFORE express.json() can touch it
app.post("/paytm/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = req.body.toString("utf8");          // raw bytes -> string
  const parsed = JSON.parse(rawBody);
  const sig = parsed?.head?.signature;

  const valid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, sig);
  if (!valid) return res.status(401).send("invalid signature");

  // dedup + fulfill
  ...
});
```

If you use `express.json()` globally, **mount the webhook route BEFORE** that middleware, or scope `express.json()` to other routes only. Otherwise Express parses the body and the raw bytes are gone.

### Python (Flask)

```python
from flask import Flask, request
from paytmchecksum import PaytmChecksum

app = Flask(__name__)

@app.post("/paytm/webhook")
def webhook():
    raw_body = request.get_data(as_text=True)   # raw before json parse
    parsed = json.loads(raw_body)
    sig = (parsed.get("head") or {}).get("signature")

    if not PaytmChecksum.verifySignature(raw_body, MERCHANT_KEY, sig):
        return "invalid signature", 401

    # dedup + fulfill
    ...
    return "ok", 200
```

`request.get_data()` returns bytes; pass as `as_text=True` for the string version. Don't use `request.json` - it doesn't preserve the original byte sequence.

### Java (Spring Boot 3 / Jakarta)

```java
@PostMapping(value = "/paytm/webhook", consumes = MediaType.ALL_VALUE)
public ResponseEntity<String> webhook(HttpServletRequest request) throws Exception {
    String rawBody;
    try (var reader = request.getReader()) {
        rawBody = reader.lines().collect(Collectors.joining("\n"));
    }
    JsonNode parsed = objectMapper.readTree(rawBody);
    String sig = parsed.path("head").path("signature").asText();

    if (!PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, sig)) {
        return ResponseEntity.status(401).body("invalid signature");
    }
    // dedup + fulfill
    return ResponseEntity.ok("ok");
}
```

Avoid `@RequestBody Map<String, Object>` - Spring re-serializes that and the signature won't match. Pull the body manually.

### Java (Spring legacy / `javax.servlet`)

Same pattern as above, but `import javax.servlet.http.HttpServletRequest;` instead of `jakarta.servlet`.

The shipped backends (`scripts/backend-{node,python,spring,spring-legacy}/`) each have a working `webhookHandler.*` - copy verbatim.

---

## Dedup pattern (in-memory + DB)

In-memory ring buffer is fine for low-volume merchants (200 events covers the last few minutes of duplicates). For production, use Redis SETEX with a TTL of ~10 minutes (long enough to catch Paytm's retry burst) backed by a unique constraint in your DB for permanent dedup.

Dedup key:
- Payment events: `(orderId, status)` - `TXN_SUCCESS` followed by another `TXN_SUCCESS` for the same orderId is a duplicate; `PENDING` -> `TXN_SUCCESS` for the same orderId is a legitimate state transition (different status).
- Refund events: `(refId, status)` - same logic.

```js
const SEEN_TTL_MS = 10 * 60 * 1000;     // 10 minutes
const recent = new Map();

function dedup(key) {
  const now = Date.now();
  // sweep expired
  for (const [k, t] of recent) if (now - t > SEEN_TTL_MS) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

const dedupKey = evt.txnType === "REFUND"
  ? `refund:${evt.refId}:${evt.status}`
  : `payment:${evt.orderId}:${evt.status}`;

if (dedup(dedupKey)) return res.status(200).send("duplicate");
```

The reference backends include this pattern - swap the in-memory `Map` for Redis in prod.

---

## Security checklist

- **TLS required.** Paytm rejects self-signed certs in production. Use a real CA-signed cert.
- **IP allowlist:** Paytm's webhook source IPs are published on the dashboard. Add to firewall allowlist if you have one. Don't rely on this alone - signature verification is the real check.
- **Reject unauthenticated requests:** any non-200 path on `/paytm/webhook` should return 401, not 404 - 404 reveals the endpoint exists but is misconfigured.
- **Don't log the raw body in plaintext** - it contains transaction details. Log a redacted summary instead (`orderId`, `status`, `txnType`).
- **Idempotency hash:** if you're paranoid, hash the raw body and stash it. Subsequent calls with the same hash are exact duplicates - skip even before signature verify (saves CPU).
- **Rate limit your own endpoint:** Paytm won't DDoS you, but if your endpoint is exposed publicly, anyone can spam it. Reject anything that fails signature verification quickly with 401 and a small response body.

---

## Operational checklist before shipping

1. Endpoint reachable from public internet (no VPN, no IP-restricted dev env).
2. TLS valid, not expired, not self-signed.
3. Response time **< 30 s** under load - if fulfilment is slow, queue it: webhook returns 200 immediately, worker does the DB write.
4. Logs include `orderId`, `signature_verified`, `dedup_hit`, `outcome` for every request. Mandatory for ops.
5. Alerting on 401 spikes (could be attack / could be MERCHANT_KEY rotation drift).
6. Alerting on 5xx rate > 1% (Paytm retries forever; persistent 5xx = stuck fulfilment pipeline).
7. Pair with polling for QR + payment-link flows where webhooks are sometimes lost.
8. Webhook URL configured on the dashboard - go to Developer Settings -> Webhooks. Add the URL once per environment (staging + prod separately).

---

## Disabling webhooks for an environment

Sometimes useful in staging to avoid cluttering logs. On the dashboard: Developer Settings -> Webhooks -> toggle off, or set the URL to a black-hole endpoint. **Don't** disable in production unless you're 100% sure your polling fallback catches every state transition.

---

## Common failure modes

| Symptom | Cause |
|---|---|
| Signature verification always fails | Raw body got re-serialized somewhere in the middleware chain. Confirm `express.raw` / `request.get_data()` runs before any JSON parser. |
| Duplicate events processed | Dedup TTL too short, or dedup key wrong (`(orderId)` alone is not enough - same order has multiple events with different statuses). |
| Paytm webhook never arrives | URL not configured on the dashboard, or endpoint returns 5xx and Paytm gave up after 10 attempts. Check dashboard webhook logs. |
| Webhook arrives but no DB update | Endpoint returned 200 before the DB write completed (e.g. `res.send()` mid-function). Always 200 LAST, after side effects. |
| Endpoint times out under load | Synchronous fulfilment too slow. Queue the event, return 200 immediately, worker processes it asynchronously. |
| Customer's bank txn shows but no webhook | Webhook delivery lost. Reconcile via `/v3/order/status` poll. Webhooks are best-effort, not guaranteed. |
