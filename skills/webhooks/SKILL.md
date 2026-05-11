---
name: paytm-webhooks
description: >
  Server-to-server (S2S) webhook receiver for Paytm payment events - the source of truth that
  outlives lost browser callbacks. Covers: raw-body extraction (re-serializing breaks the
  signature), signature verification against `head.signature`, dedup on `(orderId, status)` for
  at-least-once delivery, the 200/401/5xx response contract that controls Paytm retries, and a
  reference handler stub. Load this skill when the user mentions "webhook", "S2S notification",
  "callback (server-side)", "fulfilment hook", or "signature verification" in a Paytm context.
triggers:
  - "/paytm/webhook"
  - "S2S notification"
  - "head.signature"
  - "raw body"
  - "verifySignature"
---

# Paytm S2S Webhooks

The browser callback can be lost (popup blockers, network drops, browser back button). The S2S webhook is the **source of truth** — Paytm POSTs the same payment event server-to-server, retrying until you 200.

Reference implementation in every backend: `scripts/backend-{node,python,spring,spring-legacy}/` — copy verbatim.

---

## Endpoint contract

```
POST /paytm/webhook
Content-Type: application/json
```

Body shape:
```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "...",
    "orderId": "...",
    "txnId": "...",
    "txnAmount": "...",
    "status": "TXN_SUCCESS | TXN_FAILURE | PENDING",
    "respCode": "...",
    "respMsg": "..."
  }
}
```

Status values: same as JS Checkout — `TXN_SUCCESS`, `TXN_FAILURE`, `PENDING`.

---

## Implementation rules

1. **Read the raw body bytes BEFORE any JSON parser touches them.** Re-serializing (`JSON.stringify(JSON.parse(body))`) reorders keys / strips whitespace and breaks the signature. Each backend ships a brace-walking raw-body extractor — use it.

2. **Verify `head.signature` against the raw body** using `PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, headSignature)`. If verification fails, return **401** — do NOT process.

3. **Dedup on `(orderId, status)`.** Paytm delivers at-least-once; the same event can arrive multiple times. Maintain a small ring buffer (200 events is plenty in memory; use Redis / DB in prod). Idempotent dedup is the difference between "user charged once" and "user double-shipped".

4. **Return 200 fast on success or duplicate.** Paytm treats anything else as failure and retries. Return 5xx only for genuine processing errors you want retried.

5. **Call `fulfillOrder(event)` last.** Side-effects (DB write, queue push, email) happen after dedup. Failures here = 5xx so Paytm retries; success = 200.

---

## Sketched handler (Node/Express)

```js
app.post("/paytm/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = req.body.toString("utf8");
  const parsed = JSON.parse(rawBody);
  const sig = parsed?.head?.signature;

  if (!sig || !PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, sig)) {
    return res.status(401).send("invalid signature");
  }

  const evt = parsed.body || {};
  const dedupKey = `${evt.orderId}:${evt.status}`;
  if (recentEvents.has(dedupKey)) return res.status(200).send("duplicate");
  recentEvents.add(dedupKey);

  try {
    await fulfillOrder(evt);   // your business logic
    return res.status(200).send("ok");
  } catch (e) {
    return res.status(500).send("retry");
  }
});
```

Same pattern in Python / Java in the reference backends — language-idiomatic but identical contract.

---

## Operational checklist

- Endpoint reachable from Paytm's IPs (no IP allowlist on your firewall, or add Paytm's range).
- TLS cert valid (Paytm rejects self-signed in production).
- Response time < 30s — long-running fulfillment goes to a queue, webhook returns 200 immediately.
- Logs include `orderId` + `signature_verified` + `dedup_hit` + `outcome` for every request.
- Pair with `/v3/order/status` poll for QR / link flows where webhooks aren't always pushed.

---

## When to load related skills

- **Browser callback verification** (UPPERCASE form params, sorted dict for checksum) → `js-checkout` skill.
- **Reconciling payment links** → `payment-links` skill (use `/link/fetchTransaction`, not `/v3/order/status`).
- **QR polling** → `qr-codes` skill.
