---
name: paytm-migrate-from-cashfree
description: >
  Migration playbook for moving from Cashfree Payments (Payment Gateway, Subscriptions, Payouts,
  Easy Split) to Paytm Payment Gateway. Covers the Cashfree session/order model -> Paytm's
  `txnToken` + JS Checkout, X-Client-Id / X-Client-Secret header auth -> Paytm body checksum,
  webhook signature scheme, recurring payments, refunds, and dual-write rollout. Load when the
  user mentions migrating, switching, or moving from Cashfree to Paytm, or has a Cashfree
  integration in the codebase (e.g. `cashfree-pg`, `Cashfree.PG.Orders.CreateOrder`,
  `cashfreepayments.com`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `x-client-id` headers,
  `payment_session_id`, `/pg/orders`).
triggers:
  # Code-context signals
  - "cashfree"
  - "Cashfree"
  - "cashfree-pg"
  - "cashfree-pg-sdk-nodejs"
  - "cashfree-pg-sdk-python"
  - "cashfreepayments.com"
  - "api.cashfree.com"
  - "sandbox.cashfree.com"
  - "CASHFREE_APP_ID"
  - "CASHFREE_SECRET_KEY"
  - "Cashfree.PG.Orders"
  - "Cashfree.PGCreateOrder"
  - "payment_session_id"
  - "cf_order_id"
  - "cf_payment_id"
  - "/pg/orders"
  - "x-client-id"
  - "x-client-secret"
  # Direct migration intent
  - "migrate from cashfree"
  - "migrating from cashfree"
  - "migration from cashfree"
  - "cashfree to paytm"
  - "cashfree → paytm"
  - "cashfree -> paytm"
  - "from cashfree to paytm"
  - "switch from cashfree"
  - "switching from cashfree"
  - "move from cashfree"
  - "moving from cashfree"
  - "port from cashfree"
  - "shift from cashfree"
  - "transition from cashfree"
  - "swap cashfree"
  - "swap out cashfree"
  - "replace cashfree"
  - "replacing cashfree"
  - "remove cashfree"
  - "drop cashfree"
  - "ditch cashfree"
  - "leave cashfree"
  - "exit cashfree"
  - "retire cashfree"
  - "phase out cashfree"
  - "decommission cashfree"
  - "cutover from cashfree"
  # Merchant conversational
  - "want to use paytm instead of cashfree"
  - "thinking of switching from cashfree"
  - "considering paytm over cashfree"
  - "cashfree alternative"
  - "alternative to cashfree"
  - "instead of cashfree"
  - "unhappy with cashfree"
  - "cashfree not working for us"
  - "cashfree is expensive"
  - "cashfree account suspended"
  - "cashfree settlement delay"
  - "cashfree support bad"
  - "change payment gateway from cashfree"
  - "change pg from cashfree"
  - "stop using cashfree"
  - "get rid of cashfree"
  - "dual write cashfree paytm"
---

# Cashfree → Paytm Migration

Use this skill when a merchant has a working Cashfree Payments integration and wants to switch to Paytm. Covers the API mental-model translation, signature scheme differences, recurring payments, refunds, dual-write rollout, and cutover.

Full per-flow mapping, signature deep dive, and pitfalls in `references/REFERENCE.md`.

---

## At a glance

| Concept | Cashfree | Paytm |
|---|---|---|
| Identifier | `X-Client-Id` + `X-Client-Secret` (app id + secret key) | `MID` + `MERCHANT_KEY` |
| Order create | `POST /pg/orders` (returns `payment_session_id`) | `POST /theia/api/v1/initiateTransaction` (returns `txnToken`) |
| Auth on each request | Two HTTP headers: `x-client-id`, `x-client-secret`, `x-api-version` | Body checksum in `head.signature` |
| Browser checkout | `Cashfree({ mode }).checkout({ paymentSessionId, ... })` | `Paytm.CheckoutJS.init({ ... }).then(invoke)` |
| Webhook signature | `x-webhook-signature` header — HMAC-SHA256 of `timestamp + rawBody` with secret key, base64-encoded | `head.signature` field in body — `PaytmChecksum.verifySignature(rawBody, KEY, sig)` |
| Refund | `POST /pg/orders/{order_id}/refunds` | `POST /refund/apply` |
| Subscription | Cashfree Subscriptions API (`POST /pg/subscriptions`) | `POST /subscription/create` (NATIVE_SUBSCRIPTION, flat body) |
| Source of truth | `GET /pg/orders/{order_id}` + `GET /pg/orders/{order_id}/payments` | `POST /v3/order/status` |

**Critical mental shift:** Cashfree's auth is **two custom HTTP headers per request**. Paytm's auth is a **body checksum field**. Reusing Cashfree's `x-client-secret` header against Paytm endpoints does nothing (Paytm ignores the headers) and the request fails with checksum mismatches that look unrelated.

**Second mental shift:** Cashfree exposes an explicit **API version** via `x-api-version` (e.g. `2022-09-01`, `2023-08-01`). Paytm has no equivalent — its endpoints version implicitly. Drop the version-header concept entirely when porting.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Greenfield rewrite | **Cutover** — replace Cashfree `pg/orders` + `cashfree.checkout()` with Paytm REST + JS Checkout | `REFERENCE.md` § Direct cutover |
| Production traffic | **Dual-write canary** — sticky-hash by customer; both gateways live; % traffic to Paytm | `REFERENCE.md` § Dual-write |
| Cashfree-specific features (Easy Split, Payouts) | **Partial migration** — switch PG flows, keep Cashfree for Split / Payouts long-term | `REFERENCE.md` § Permanent multi-PSP |

Reference dual-write implementation (generic): `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Adapt by swapping the source-PSP branch for Cashfree's `Cashfree.PG.Orders.CreateOrder()`.

---

## Per-flow mapping (high level)

Each row corresponds to a focused mapping section in `references/REFERENCE.md`.

### One-time payments (cards, UPI, NB, EMI)

```
Cashfree                                            Paytm
────────                                            ─────
1. POST /pg/orders                            →     POST /theia/api/v1/initiateTransaction
   headers: x-client-id, x-client-secret,             body checksum in head.signature
            x-api-version
   body: { order_id, order_amount, order_currency,
           customer_details, order_meta }
   returns: { payment_session_id, order_id, ... }     returns: { body: { txnToken, resultInfo } }

2. Frontend: cashfree.checkout({              →     Paytm.CheckoutJS.init({ data: { token: txnToken, ... } })
     paymentSessionId, redirectTarget: "_self" })       .then(() => Paytm.CheckoutJS.invoke())

3. Verify: GET /pg/orders/:order_id           →     POST /v3/order/status
   pull order_status + payment_status                  body.resultInfo.resultStatus
```

→ Load the `js-checkout` skill alongside.

### Subscriptions

```
Cashfree                                            Paytm
────────                                            ─────
1. POST /pg/subscriptions                     →     POST /subscription/create
   creates a Subscription with Plan id                requestType: "NATIVE_SUBSCRIPTION"
                                                      FLAT body (no subscriptionDetails wrapper)
                                                      head: { clientId, channelId, signature }

2. Frontend: cashfree.subscribe({...})        →     Same Paytm.CheckoutJS modal as one-time payment

3. Cashfree auto-debits per cycle             →     Paytm auto-debits per cycle
4. Webhook per cycle: SUBSCRIPTION_PAYMENT    →     Webhook: txnType: "SUBSCRIPTION_DEBIT"
5. Cancel: POST /pg/subscriptions/:id/cancel  →     POST /subscription/cancel
```

→ Load the `subscriptions` skill alongside.

### Refunds

```
Cashfree                                            Paytm
────────                                            ─────
POST /pg/orders/:order_id/refunds             →     POST /refund/apply
  { refund_amount, refund_id, refund_note }          { body: { txnType: "REFUND", orderId, txnId,
                                                       refId, refundAmount } }
GET /pg/orders/:order_id/refunds/:refund_id   →     POST /refund/status
Refund webhook                                       Same /paytm/webhook endpoint, txnType: "REFUND"
```

→ Load the `refunds` skill alongside.

### Webhooks

```
Cashfree                                            Paytm
────────                                            ─────
HTTP POST { type, data, event_time }          →     HTTP POST { head: { signature }, body: { ... } }
Headers:
  x-webhook-signature: <base64-HMAC-SHA256(timestamp+rawBody, secret)>
  x-webhook-timestamp: <epoch_seconds>
  x-webhook-version: <api-version>

Verify: HMAC over (timestamp + rawBody)            Verify: PaytmChecksum.verifySignature(rawBody, KEY, sig)
        compare base64-encoded result               using the merchant key
        to header
Event types:                                        body.txnType distinguishes:
  PAYMENT_SUCCESS_WEBHOOK_V2                          "SALE" - one-time payment
  PAYMENT_FAILED_WEBHOOK_V2                           "REFUND"
  REFUND_STATUS_WEBHOOK                               "SUBSCRIPTION_DEBIT" / "SUBSCRIPTION_CANCEL"
  SUBSCRIPTION_PAYMENT_WEBHOOK
```

→ Load the `webhooks` skill alongside.

---

## Signature scheme — the highest-confusion area

**Cashfree:** API requests use **two HTTP headers** (`x-client-id` and `x-client-secret`). Webhooks use a **separate scheme**: `HMAC-SHA256(timestamp + rawBody, secretKey)` → base64-encoded, sent as `x-webhook-signature` header. The webhook timestamp is in `x-webhook-timestamp`.

**Paytm:** every API request body carries a `head.signature` field — checksum of the JSON-stringified body using `MERCHANT_KEY`. The Paytm checksum library handles both sides. **No HTTP custom headers** for auth. **No timestamp prepending** for webhooks.

**Common bug** when porting: developers reuse Cashfree's `crypto.createHmac("sha256", secret).update(timestamp + body)` against Paytm webhooks. Paytm rejects with checksum mismatch because (a) signature goes inside body not header, (b) no timestamp prepended, (c) verification must use the official library.

---

## When to load related skills

This skill is the **migration translator**. Always pair with the matching flow skill:

- One-time payment → also load `js-checkout`
- Subscription → also load `subscriptions`
- Payment link → also load `payment-links` (Cashfree's "Payment Links" map cleanly)
- Refund → also load `refunds`
- Webhook → also load `webhooks`
- Mobile SDK → also load `all-in-one-sdk` or `custom-sdk`
- Errors during migration → `troubleshooting`
