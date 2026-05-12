# Razorpay → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping, field-name translation, signature scheme deep dive, dual-write rollout pattern, reconciliation, cutover checklist.

---

## Concepts mapping

| Razorpay term | Paytm term | Notes |
|---|---|---|
| `key_id` | `MID` | Identifier |
| `key_secret` | `MERCHANT_KEY` | Signing secret |
| `order_id` (Razorpay-issued) | `orderId` (merchant-issued) | **Direction differs** - Razorpay generates, Paytm expects you to generate. Pre-allocate in your DB. |
| `payment_id` (`pay_xxx`) | `TXNID` | Per-payment Paytm-issued id |
| `razorpay_signature` | `head.signature` / `CHECKSUMHASH` | Signing scheme is different (see below) |
| `notes` (free-form metadata) | `userInfo.custId` + `extraParamsMap` | Paytm has tighter schema |
| `entity` field on every response | `body` envelope | Paytm wraps everything in `{ head, body }` |
| Plans (subscriptions) | (no equivalent) | Paytm subscriptions carry the amount inline; no separate Plan resource |

---

## Auth model — every API call

### Razorpay

```js
// HTTP Basic Auth on every request
fetch("https://api.razorpay.com/v1/orders", {
  method: "POST",
  headers: {
    "Authorization": "Basic " + btoa(KEY_ID + ":" + KEY_SECRET),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ amount: 10000, currency: "INR" }),
});
```

### Paytm

```js
// Body checksum, no HTTP auth
import PaytmChecksum from "paytmchecksum";

const body = {
  requestType: "Payment",
  mid: MID,
  websiteName: WEBSITE_NAME,
  orderId,
  callbackUrl,
  txnAmount: { value: "100.00", currency: "INR" },
  userInfo: { custId },
};
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);

fetch(`https://securestage.paytmpayments.com/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ head: { signature }, body }),
});
```

Two completely different mental models. Don't try to port the auth helper directly — use `paytmchecksum`.

---

## One-time payment - full per-step diff

### Step 1: server creates order

| | Razorpay | Paytm |
|---|---|---|
| Endpoint | `POST https://api.razorpay.com/v1/orders` | `POST {BASE}/theia/api/v1/initiateTransaction?mid=...&orderId=...` |
| Auth | HTTP Basic | Body `head.signature` |
| Amount | `amount: 10000` (paise, integer) | `txnAmount.value: "100.00"` (rupees, two-decimal STRING) |
| Currency | `currency: "INR"` | `txnAmount.currency: "INR"` |
| Order id | `receipt` (your id, optional) - Razorpay returns its own `id` | `orderId` (your id, MANDATORY, charset `[A-Za-z0-9_@-]`, ≤ 50) |
| Customer id | `notes: { customer_id: "..." }` | `userInfo.custId: "..."` (sanitize same regex) |
| Returns | `{ id: "order_xxx", amount, currency, status: "created" }` | `{ body: { txnToken: "...", resultInfo: {...} } }` |

**Code diff:**

```js
// Razorpay
const order = await razorpay.orders.create({
  amount: 10000,
  currency: "INR",
  receipt: "ORD_001",
  notes: { customer_id: "CUST_1" },
});
// order.id is razorpay-issued; pass to frontend
```

```js
// Paytm
const orderId = "ORD_001";   // your id, must be unique even on retry
const body = {
  requestType: "Payment",
  mid: MID,
  websiteName: WEBSITE_NAME,
  orderId,
  callbackUrl,
  txnAmount: { value: "100.00", currency: "INR" },
  userInfo: { custId: "CUST_1" },
};
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);
const r = await fetch(...);
const txnToken = (await r.json()).body.txnToken;  // pass to frontend
```

### Step 2: frontend payment UI

| | Razorpay | Paytm |
|---|---|---|
| Loader | `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>` | `<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js" crossorigin="anonymous"></script>` |
| Open | `new Razorpay({ key: KEY_ID, order_id, amount, ...handler }).open()` | `Paytm.CheckoutJS.init({ root, flow, data: {orderId, token, tokenType, amount}, handler }).then(invoke)` |
| Success callback | `handler(response)` with `razorpay_payment_id` + `razorpay_signature` | `handler.transactionStatus(data)` with `STATUS`, `RESPCODE`, `RESPMSG` (UPPERCASE keys) |
| Cancel callback | `modal.ondismiss` | `handler.notifyMerchant(eventName, data)` for `APP_CLOSED` / `SESSION_EXPIRED` |

The Paytm `onLoad` trap (calling `Paytm.CheckoutJS.onLoad(...)` inside a click handler — fires too late) doesn't exist on Razorpay. New bug class to watch for after migration. See `js-checkout` skill § Step 3.

### Step 3: server-side verification

| | Razorpay | Paytm |
|---|---|---|
| What to verify | `razorpay_signature` returned to the browser | `CHECKSUMHASH` in callback POST body (form-encoded) |
| Signature input | `order_id + "|" + payment_id` | The raw form body bytes (sorted params minus `CHECKSUMHASH`) |
| Algorithm | HMAC-SHA256 with `key_secret` | HMAC via `PaytmChecksum.verifySignature` |
| Is it the source of truth? | No - call `GET /v1/payments/:id` next | No - call `POST /v3/order/status` next (see step 4) |

```js
// Razorpay verify
const expected = crypto.createHmac("sha256", KEY_SECRET)
  .update(orderId + "|" + paymentId)
  .digest("hex");
if (expected !== razorpaySignature) throw new Error("invalid");
```

```js
// Paytm verify
const valid = await PaytmChecksum.verifySignature(rawCallbackBody, MERCHANT_KEY, checksumhash);
if (!valid) return res.status(401).send("invalid");
```

### Step 4: source-of-truth status check

| | Razorpay | Paytm |
|---|---|---|
| Endpoint | `GET /v1/payments/:payment_id` | `POST /v3/order/status` |
| Body | (no body, GET) | `{ head: { signature }, body: { mid, orderId } }` |
| Status field | `status: "captured" / "failed" / "authorized"` | `body.resultInfo.resultStatus: "TXN_SUCCESS" / "TXN_FAILURE" / "PENDING"` |

**Critical:** the `head` for `/v3/order/status` has ONLY `signature` — no `tokenType`, no `timestamp`. Mixing in fields from the Payment Link API head causes mysterious checksum mismatches.

---

## Subscriptions - full mapping

### Razorpay model

```
1. Create Plan (POST /v1/plans)        - reusable amount + interval definition
2. Create Subscription (POST /v1/subscriptions)
   - link to plan_id
   - returns short_url for customer mandate consent
3. Customer authorizes mandate at short_url
4. Razorpay charges automatically per cycle
5. Each charge = subscription.charged webhook
```

### Paytm model

```
1. NO plans concept - amount lives on the subscription itself
2. POST /subscription/create
   - requestType: "NATIVE_SUBSCRIPTION"
   - flat body (no subscriptionDetails wrapper)
   - returns txnToken
3. Open Paytm.CheckoutJS with that txnToken - mandate consent screen
4. Paytm charges automatically per cycle
5. Each charge = webhook with txnType: "SUBSCRIPTION_DEBIT"
```

### Field-by-field

| Razorpay | Paytm | Notes |
|---|---|---|
| `plan_id` | (no equivalent) | Bake amount into subscription create body |
| `total_count` | `subscriptionExpiryDate` | Razorpay counts cycles; Paytm uses an end date |
| `quantity` | (use total amount * quantity) | Multiply server-side |
| `customer_notify` | (always notifies via SMS/email if `userInfo` present) | Paytm controls this |
| `start_at` (epoch) | `subscriptionStartDate` (YYYY-MM-DD) | Format conversion |
| `expire_by` | `subscriptionExpiryDate` | Same date |
| `notes` | `userInfo.custId` + flat fields | Sanitize custId |
| `addons` | (not supported) | Drop, or model as separate one-time charge |

### Frequency mapping

| Razorpay | Paytm `subscriptionFrequency` + `subscriptionFrequencyUnit` |
|---|---|
| `period: "daily", interval: 1` | `1`, `DAY` |
| `period: "weekly", interval: 1` | `7`, `DAY` (or `1`, `WEEK` if MID supports it) |
| `period: "monthly", interval: 1` | `1`, `MONTH` |
| `period: "yearly", interval: 1` | `1`, `YEAR` |

**Don't forget** — `subscriptionGraceDays` must be < cycle length on Paytm. Razorpay has no such constraint. See `subscriptions` skill § default rules.

### Charge cycle event mapping

```
Razorpay event                          Paytm webhook body
──────────────                          ──────────────────
subscription.activated              →   txnType: "SUBSCRIPTION_INIT", status: TXN_SUCCESS
subscription.charged                →   txnType: "SUBSCRIPTION_DEBIT", status: TXN_SUCCESS
subscription.pending                →   txnType: "SUBSCRIPTION_DEBIT", status: PENDING
subscription.halted                 →   No direct equivalent - reconcile via /subscription/status
subscription.cancelled              →   txnType: "SUBSCRIPTION_CANCEL", status: TXN_SUCCESS
```

---

## Payment Links - mapping

| | Razorpay | Paytm |
|---|---|---|
| Create | `POST /v1/payment_links` | `POST /link/create` |
| Body shape | `{ amount, currency, customer: { name, email, contact }, notify: { sms, email } }` | `{ body: { linkType, linkName, linkDescription, amount, customerContact: {...}, sendSms, sendEmail } }` |
| Identifier returned | `id: "plink_xxx"` (string) | `linkId` (JSON **number** - not string!) |
| Link status field | `status: "created" / "paid" / "cancelled"` | `linkStatus: "ACTIVE"` OR `isActive: true` (dual-shape per MID) |
| Status check | `GET /v1/payment_links/:id` | `POST /link/fetch` |
| Transaction reconcile | `GET /v1/payment_links/:id` (returns payment array) | `POST /link/fetchTransaction` (NOT `/v3/order/status`) |
| Order status in transaction | `payment.status: "captured"` | `orderStatus: "SUCCESS"` OR `"TXN_SUCCESS"` (dual-shape per MID) |
| Cancel | `POST /v1/payment_links/:id/cancel` | `POST /link/expire` |
| Resend SMS/email | `POST /v1/payment_links/:id/notify_by` | `POST /link/resendNotification` (NOT `/link/resend`) |

**Charset gotcha** unique to Paytm: `linkName` is alphanumerics ONLY (no spaces — error 5007). Razorpay accepts spaces. Sanitize when porting.

**Head shape gotcha:** `/link/*` endpoints use `head: { tokenType: "AES", signature, timestamp? }`. Different from `/v3/order/status`. See `payment-links` skill.

---

## Refunds - mapping

| | Razorpay | Paytm |
|---|---|---|
| Create | `POST /v1/payments/:id/refund` | `POST /refund/apply` |
| Body | `{ amount, notes, speed: "normal"/"optimum" }` | `{ body: { txnType: "REFUND", orderId, txnId, refId, refundAmount } }` |
| Refund id | Razorpay returns `id: "rfnd_xxx"` | You provide `refId`; Paytm returns `refundId` |
| Idempotency | Pass `Idempotency-Key` header | Reuse same `refId` (Paytm dedups per `refId`) |
| Status check | `GET /v1/refunds/:id` | `POST /refund/status` |
| Webhook event | `refund.created`, `refund.processed`, `refund.failed` | Same /paytm/webhook with `txnType: "REFUND"` |
| Speed control | `speed: "optimum"` for instant refunds | Not configurable per-refund |

---

## Webhooks - signature scheme deep dive

### Razorpay

```
HTTP POST /your/webhook/url
Headers:
  X-Razorpay-Signature: <hmac-sha256-hex of raw body, signed with webhook secret>
  X-Razorpay-Event-Id: <unique event id>
Body:
  { "event": "payment.captured", "payload": { ... }, ... }
```

Verification:
```js
const expected = crypto.createHmac("sha256", WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
if (expected !== req.headers["x-razorpay-signature"]) return res.status(401);
```

### Paytm

```
HTTP POST /your/webhook/url
Headers:
  Content-Type: application/json
Body:
  { "head": { "signature": "<hmac>" }, "body": { "mid", "orderId", "txnId", "status", ... } }
```

Verification:
```js
const valid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, parsed.head.signature);
if (!valid) return res.status(401);
```

**Key differences:**

1. Signature in **header** (Razorpay) vs **body field** (Paytm).
2. Paytm uses your `MERCHANT_KEY` for both API and webhooks; Razorpay has a separate `WEBHOOK_SECRET` you configure on the dashboard.
3. Both demand verification against the **raw body bytes** (no re-serializing).
4. Paytm event types are inside `body.txnType`; Razorpay has top-level `event`.

### Event mapping

| Razorpay event | Paytm `body.txnType` + `body.status` |
|---|---|
| `payment.captured` | `SALE` (or absent), `TXN_SUCCESS` |
| `payment.failed` | `SALE`, `TXN_FAILURE` |
| `payment.authorized` | `SALE`, `PENDING` |
| `refund.created` / `refund.processed` | `REFUND`, `TXN_SUCCESS` |
| `refund.failed` | `REFUND`, `TXN_FAILURE` |
| `subscription.activated` | `SUBSCRIPTION_INIT`, `TXN_SUCCESS` |
| `subscription.charged` | `SUBSCRIPTION_DEBIT`, `TXN_SUCCESS` |
| `subscription.cancelled` | `SUBSCRIPTION_CANCEL`, `TXN_SUCCESS` |
| `payment_link.paid` | (no specific event - reconcile via `/link/fetchTransaction`) |
| `qr_code.credited` | `QR_PAYMENT`, `TXN_SUCCESS` |

### Retry behavior

| | Razorpay | Paytm |
|---|---|---|
| Retry window | ~24 hours, 12 attempts | ~7 days, 10 attempts |
| 2xx response | Stops retries | Stops retries |
| Non-2xx | Retries with exponential backoff | Same |
| Dedup expected? | Yes - `X-Razorpay-Event-Id` is unique | Yes - dedup on `(orderId, status)` or `(refId, status)` for refunds |

---

## Dual-write rollout pattern

The pattern lets you run both gateways in parallel, route a percentage of traffic to Paytm, and roll back instantly if metrics dip.

### Architecture

```
                     ┌───────────────────────────────┐
                     │  Order create endpoint        │
                     │  POST /api/checkout/start     │
                     └───────────┬───────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────────┐
                  │  Routing decision                │
                  │  hash(customerId) % 100 < CANARY │
                  └─────────┬───────────────┬────────┘
                            │ true          │ false
                            ▼               ▼
                       ┌─────────┐    ┌──────────┐
                       │  Paytm  │    │ Razorpay │
                       └────┬────┘    └────┬─────┘
                            │              │
                            ▼              ▼
                  ┌──────────────────────────────────┐
                  │  Persist outcome to DB           │
                  │  + emit metric: psp=paytm|razorpay│
                  │              outcome=success|fail │
                  │              latency=ms           │
                  └──────────────────────────────────┘
```

### Canary percentage helper

```js
function shouldUsePaytm(customerId, canaryPct) {
  const hash = crypto.createHash("sha256").update(customerId).digest();
  return (hash.readUInt32BE(0) % 100) < canaryPct;
}
```

Hash-based selection is **sticky per customer**: a given customer always lands on the same gateway across retries, so a checkout attempt that started on Paytm doesn't accidentally retry on Razorpay (which would lose context and fail).

Increase `CANARY_PCT` env var weekly. Roll back instantly by setting it to 0.

### What to monitor during canary

- Success rate per gateway (sliced by payment option).
- p50 / p95 / p99 latency.
- Webhook receive rate (% of created orders that get a final status webhook within 30s).
- Reconciliation discrepancy rate (DB state vs gateway state).
- User-facing error messages (some banks show different errors for Paytm vs Razorpay; product team needs to vet).

### Reconciliation script (daily)

For each new order in the past 24h:
1. Pull final state from your DB.
2. Pull final state from the gateway used (`GET /v1/payments/:id` or `POST /v3/order/status`).
3. Compare. Flag discrepancies for manual review.
4. Aggregate by gateway. Track DB-vs-gateway drift over time.

If Paytm drift > 5x Razorpay drift, hold canary at current % until investigated.

---

## Cutover checklist

When canary at 100% is stable for ≥ 2 weeks:

- [ ] All new orders going to Paytm.
- [ ] Razorpay credentials still configured but **only** used for refunds + dispute responses on legacy transactions.
- [ ] Razorpay webhooks still wired (you'll receive refund webhooks for in-flight refunds).
- [ ] Refund script knows which gateway each historical order used (column in DB: `psp_used: "razorpay" | "paytm"`).
- [ ] Customer support team trained on Paytm dashboard (different UI, different terminology than Razorpay).
- [ ] Settlement reconciliation team aware of new settlement schedule (Paytm settlement timing may differ from Razorpay's).
- [ ] Tax / GST reports updated to pull from both gateways for the cutover quarter.
- [ ] Legacy Razorpay credentials kept active for **90 days minimum** for refunds & disputes on historical transactions.

After 90 days of zero new Paytm-side issues, you can rotate Razorpay keys / cancel the contract.

---

## Common pitfalls when porting

| Bug seen in production | Cause | Fix |
|---|---|---|
| Checksum mismatches everywhere | Developer reused Razorpay's `crypto.createHmac` directly against Paytm endpoints | Use `paytmchecksum` library; signature goes in body, not header |
| Amount off by 100x | Forgot Razorpay = paise, Paytm = rupees | Convert: `paytmAmount = (razorpayAmount / 100).toFixed(2)` |
| Order id rejected | Used Razorpay's `order_xxx` format with underscore | Paytm allows `[A-Za-z0-9_@-]` - safe; but generate FRESH for retries |
| Subscription "cycles wrong" | Razorpay `total_count` ignored, no Paytm equivalent | Translate to `subscriptionExpiryDate` based on cycle * frequency |
| Payment link `linkId` rejected | Sent as string (Razorpay style) | Send as JSON number for Paytm |
| Refund "duplicate" | Reusing Razorpay's `id` style for `refId` | Generate fresh UUID per refund attempt; Paytm dedups per `refId` already |
| Webhook signature always fails | Verifying header (`X-Razorpay-Signature` muscle memory) | Read `body.head.signature` instead |
| Settlement amounts off | Razorpay deducts fees inline; Paytm settles gross then debits fees | Reconcile gross + fee separately |

---

## Other source gateways

This skill is Razorpay-specific. For migrations from other PSPs, equivalent skills will land in subsequent releases:
- `migrate-from-cashfree` (planned)
- `migrate-from-payu` (planned)
- `migrate-from-ccavenue` (planned)
