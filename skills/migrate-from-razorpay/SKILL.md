---
name: paytm-migrate-from-razorpay
description: >
  Migration playbook for moving an existing integration from Razorpay Payment Gateway to Paytm
  Payment Gateway. Covers per-flow API mapping (orders, payments, webhooks, refunds, subscriptions,
  links, QR), field-name translation, signature scheme differences (Razorpay HMAC-SHA256 over
  pipe-joined string vs Paytm's checksum library), dual-write rollout pattern, reconciliation,
  and cutover. Load this skill when the user mentions migrating, switching, or moving from
  Razorpay to Paytm, or has an existing Razorpay integration in the codebase (e.g. `razorpay` in
  package.json / requirements.txt / pom.xml, `rzp_live_*` / `rzp_test_*` keys, code calling
  `razorpay.orders.create()`, `razorpay.payments.fetch()`, `validateWebhookSignature`, etc.).
triggers:
  # Code-context signals
  - "razorpay"
  - "rzp_live_"
  - "rzp_test_"
  - "razorpay.orders.create"
  - "razorpay.payments"
  - "razorpay.subscriptions"
  - "razorpay-node"
  - "razorpay-python"
  - "validateWebhookSignature"
  # Direct migration intent
  - "migrate from razorpay"
  - "migrating from razorpay"
  - "migration from razorpay"
  - "razorpay to paytm"
  - "razorpay → paytm"
  - "razorpay -> paytm"
  - "from razorpay to paytm"
  - "switch from razorpay"
  - "switching from razorpay"
  - "switched from razorpay"
  - "move from razorpay"
  - "moving from razorpay"
  - "port from razorpay"
  - "porting from razorpay"
  - "shift from razorpay"
  - "transition from razorpay"
  - "convert from razorpay"
  - "swap razorpay"
  - "swap out razorpay"
  - "replace razorpay"
  - "replacing razorpay"
  - "rip out razorpay"
  - "remove razorpay"
  - "drop razorpay"
  - "ditch razorpay"
  - "leave razorpay"
  - "exit razorpay"
  - "retire razorpay"
  - "deprecate razorpay"
  - "phase out razorpay"
  - "decommission razorpay"
  - "cutover from razorpay"
  - "cut over from razorpay"
  # Merchant conversational
  - "want to use paytm instead of razorpay"
  - "thinking of switching from razorpay"
  - "considering paytm over razorpay"
  - "evaluating paytm vs razorpay"
  - "paytm better than razorpay"
  - "razorpay alternative"
  - "alternative to razorpay"
  - "instead of razorpay"
  - "unhappy with razorpay"
  - "razorpay not working for us"
  - "razorpay is expensive"
  - "razorpay high mdr"
  - "looking for razorpay alternative"
  - "change the pg from razorpay"
  - "change pg to paytm"
  - "change payment gateway to paytm"
  - "new payment gateway instead of razorpay"
  - "razorpay account suspended"
  - "razorpay account frozen"
  - "razorpay support is bad"
  - "razorpay settlement delay"
  - "stop using razorpay"
  - "get rid of razorpay"
  - "no longer want razorpay"
  - "razorpay is not right for us"
---

# Razorpay → Paytm Migration

Use this skill when a merchant has a working Razorpay integration and wants to switch to Paytm — either fully or in parallel. Covers the API mapping, signature scheme differences, dual-write rollout, and reconciliation patterns. Sample backend implementations under `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`.

> This skill is split across two files. `SKILL.md` (this file) gives the at-a-glance mapping + per-flow summary. `references/REFERENCE.md` contains the full per-endpoint diff with code samples (Razorpay side + Paytm side), the auth model deep dive, the subscription frequency / event mapping table, the webhook signature scheme deep dive (header vs body), the dual-write architecture diagram, the canary helper, the reconciliation script, the cutover checklist, and common porting pitfalls — all NOT repeated here.
>
> **Do not generate any Razorpay → Paytm migration code until you have read `references/REFERENCE.md`.**

---

## At a glance

| Concept | Razorpay | Paytm |
|---|---|---|
| Identifier | `key_id` (e.g. `rzp_test_xxx`) + `key_secret` | `MID` + `MERCHANT_KEY` |
| Order create | `POST /v1/orders` | `POST /theia/api/v1/initiateTransaction` |
| Auth on each request | HTTP Basic Auth (`key_id:key_secret`) | Body checksum in `head.signature` |
| Browser checkout | `Razorpay({ key, order_id, ... }).open()` | `Paytm.CheckoutJS.init({...}).then(invoke)` |
| Webhook signature | HMAC-SHA256 of raw body, `X-Razorpay-Signature` header | HMAC of body, `head.signature` field inside JSON |
| Refund | `POST /v1/payments/:id/refund` | `POST /refund/apply` |
| Subscription | `/v1/subscriptions` (uses Razorpay Plans) | `/subscription/create` (NATIVE_SUBSCRIPTION, flat body) |
| Payment Link | `POST /v1/payment_links` | `POST /link/create` |
| Reconciliation source of truth | `/v1/payments/:id` | `/v3/order/status` (or `/link/fetchTransaction` for link flows) |

The critical mental shift: **Razorpay's auth is HTTP Basic + ambient `X-Razorpay-Signature`. Paytm's auth is a body checksum field.** Re-using Razorpay's signing logic against Paytm endpoints fails with checksum mismatches that look like environment mismatches.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Greenfield rewrite, can swap atomically | **Cutover** — rip out Razorpay, drop in Paytm in one release | `REFERENCE.md` § Direct cutover |
| Production traffic, can't afford a bad day | **Dual-write canary** — both gateways live, % of traffic to Paytm, increase weekly | `REFERENCE.md` § Dual-write rollout |
| Compliance / contract requires both running | **Permanent dual-rail** — route based on customer / product / amount | `REFERENCE.md` § Permanent multi-PSP |

Default recommendation for any merchant doing > ₹10L/day: dual-write canary at 5% → 25% → 50% → 100% over 3-4 weeks, with reconciliation between the two gateways' settlement reports.

---

## Per-flow mapping (high level)

Each row corresponds to a focused mapping section in `references/REFERENCE.md`. Don't generate code from this table alone — read the matching reference section.

### One-time payments (cards, UPI, NB, EMI)

```
Razorpay                                          Paytm
────────                                          ─────
1. POST /v1/orders                          →     POST /theia/api/v1/initiateTransaction
   { amount: 10000, currency: "INR" }              { body: { txnAmount: { value: "100.00" } } }
   amount in PAISE (integer)                       value as STRING with two decimals (rupees)

2. Frontend: new Razorpay({ ... }).open()   →     Paytm.CheckoutJS.init({...}).then(invoke)
   Receives razorpay_payment_id +                  Receives ORDERID + TXNID + STATUS via callback URL POST
   razorpay_signature in handler

3. Verify: HMAC-SHA256                      →     PaytmChecksum.verifySignature(rawBody, KEY, sig)
   (order_id|payment_id, secret)                   over the form-encoded callback body

4. Reconcile: GET /v1/payments/:id          →     POST /v3/order/status
                                                   head.signature only (no tokenType/timestamp)
```

→ Load the `js-checkout` skill alongside this for full Paytm-side flow.

### Subscriptions (UPI Autopay, eMandate)

```
Razorpay                                          Paytm
────────                                          ─────
1. POST /v1/plans                           →     (no plans concept - amount lives on the subscription)
2. POST /v1/subscriptions { plan_id, ... }  →     POST /subscription/create
                                                   requestType: "NATIVE_SUBSCRIPTION"
                                                   FLAT body (no subscriptionDetails wrapper)
                                                   head: { clientId, channelId, signature }
                                                   query: ?mid=...&orderId=...&traceId=...
3. Frontend mandate consent: Razorpay modal →     Same Paytm.CheckoutJS modal as one-time
4. Recurring debit auto                     →     Auto via Paytm side; charge events via webhook
5. Cancel: POST /v1/subscriptions/:id/cancel →    /subscription/cancel
```

→ Load the `subscriptions` skill alongside.

### Payment Links

```
Razorpay                                          Paytm
────────                                          ─────
POST /v1/payment_links                      →     POST /link/create
  { amount: 10000, customer: { ... },              { body: { linkType, linkName, linkDescription,
    notify: { sms, email } }                         amount, customerContact, sendSms, sendEmail } }
GET /v1/payment_links/:id                   →     POST /link/fetch
GET /v1/payment_links/:id (status check)    →     POST /link/fetchTransaction
                                                   match BOTH "SUCCESS" AND "TXN_SUCCESS"
                                                   `linkId` is JSON NUMBER, not string
```

→ Load the `payment-links` skill alongside.

### Refunds

```
Razorpay                                          Paytm
────────                                          ─────
POST /v1/payments/:id/refund                →     POST /refund/apply
  { amount: 5000, notes: { ... } }                 { body: { txnType: "REFUND", orderId, txnId,
                                                     refId, refundAmount: "50.00" } }
GET /v1/refunds/:id                         →     POST /refund/status
Refund webhook event                        →     Same /paytm/webhook endpoint, txnType: "REFUND"
```

→ Load the `refunds` skill alongside.

### Webhooks

```
Razorpay                                          Paytm
────────                                          ─────
HTTP POST { event, payload, ... }           →     HTTP POST { head: { signature }, body: { ... } }
Header: X-Razorpay-Signature                →     Field: body.head.signature
HMAC-SHA256(rawBody, secret)                →     PaytmChecksum.verifySignature(rawBody, KEY, sig)
Events:                                            txnType in body distinguishes:
  payment.captured / payment.failed                "SALE" - payment
  refund.created / refund.processed                "REFUND" - refund
  subscription.charged / .cancelled                "SUBSCRIPTION_DEBIT" / "SUBSCRIPTION_CANCEL"
Retry: ~24h with backoff                          ~7 days with backoff
```

→ Load the `webhooks` skill alongside.

### QR Codes

```
Razorpay                                          Paytm
────────                                          ─────
POST /v1/payments/qr_codes                  →     POST /paymentservices/qr/create
  { type: "upi_qr", usage, fixed_amount }          { body: { posId (REQUIRED), amount: "100.00" } }
Image returned as `image_url`               →     Image returned as base64 PNG (prepend
                                                    "data:image/png;base64," before rendering)
```

→ Load the `qr-codes` skill alongside.

---

## Signature scheme — the highest-confusion area

**Razorpay:** every request is HTTP Basic auth (`key_id:key_secret`). Webhooks and payment-success callbacks are verified with HMAC-SHA256 of `order_id|payment_id` (or raw body for webhooks).

**Paytm:** every request body has a `head.signature` field — checksum of the JSON-stringified body using `MERCHANT_KEY`. No HTTP Basic. The Paytm checksum library handles both generation and verification.

**Common bug** when porting code: developers replace Razorpay's `crypto.createHmac('sha256', secret)` with the same call against Paytm and try to put it in an HTTP header. Paytm rejects the request because the signature must be inside the JSON body, not in headers. Use `paytmchecksum` (or the official SDK for your language).

---

## Test plan before going live

1. **Pre-cutover (week 0):** Paytm staging integration works end-to-end for every flow you currently use on Razorpay. Use Paytm's test cards (`4111 1111 1111 1111` for one-time, `4761 3600 7586 3216` for subscription mandate).
2. **Canary 5%** (week 1): route 5% of new orders to Paytm by customer ID hash. Monitor success rate, callback latency, webhook-receive rate. Compare against Razorpay baseline.
3. **Reconciliation report** (daily during canary): for each new order, verify both gateways' final state matches your DB. Discrepancy threshold: < 0.1%.
4. **Increase to 25% / 50% / 100%** over 3 weeks if metrics hold.
5. **Cutover** (week 4): stop sending new traffic to Razorpay. Keep Razorpay credentials live for 90 days for refunds + dispute responses on legacy transactions.

Full reconciliation script + cutover checklist in `references/REFERENCE.md`.

---

## Sample dual-write backends

Working dual-write reference implementations live under:

- `scripts/backend-node/razorpay-migration/` — Express + Razorpay Node SDK + `paytmchecksum`
- `scripts/backend-python/razorpay_migration/` — Flask + `razorpay-python` + `paytmchecksum`
- `scripts/backend-spring/src/main/java/com/paytm/sample/razorpay/` — Spring Boot 3, Jakarta
- `scripts/backend-spring-legacy/src/main/java/com/paytm/sample/razorpay/` — Spring 5, javax.servlet

Each shows: dual-write order create, signature verification on both sides, reconciliation pattern, feature-flag-driven traffic routing, refund replay.

---

## ✅ Final step — codebase cleanup scan (mandatory, do not skip)

After all functional code is migrated, run this scan to catch non-functional Razorpay references that survive every "complete" migration:

```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.html" --include="*.json" --include="*.md" \
  --include="*.env*" --include="*.yaml" --include="*.yml" \
  "razorpay\|Razorpay\|RAZORPAY\|rzp_" \
  . 2>/dev/null
```

Common survivors to check by hand:

| File / Surface | What to replace |
|---|---|
| HTML / JSX footer & copy | "Secured by Razorpay" → "Secured by Paytm" |
| `package.json` `description` field | Remove "Razorpay" mention |
| `.env.example` placeholders | `RAZORPAY_KEY_ID=...` → `PAYTM_MID=...` |
| `README.md` / docs | Setup steps, screenshots, badges |
| Code comments | `// Razorpay-style hash` / `// from Razorpay docs` |
| UI labels / modal titles | "Razorpay Checkout" → product name |
| Test fixtures | Hardcoded `rzp_test_*` keys, fake order ids |
| Translation files (i18n) | `payment.gateway.razorpay` keys |
| CI / deploy configs | Lingering env-var names |

If any of the above remain after the grep cleanup, the migration is **not** done — ship a follow-up commit before declaring it complete.

---

## When to load related skills

This skill is the **migration translator**. For Paytm-side details, always pair with the relevant skill:

- One-time payment migration → also load `js-checkout`
- Subscription migration → also load `subscriptions`
- Payment link migration → also load `payment-links`
- QR migration → also load `qr-codes`
- Webhook migration → also load `webhooks`
- Refund migration → also load `refunds`
- Mobile SDK (Razorpay Android/iOS SDK → Paytm SDK) → also load `all-in-one-sdk` or `custom-sdk`
- Errors during migration → `troubleshooting`
