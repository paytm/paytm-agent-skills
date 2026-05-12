# Cashfree → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping, header-auth vs body-checksum deep dive, webhook signature scheme, recurring payments, refunds, dual-write rollout, cutover checklist.

---

## Cashfree product surface (what each customer might have)

Cashfree has several products under one brand. Migration scope depends on which one(s) the merchant uses:

| Cashfree product | What it does | Paytm replacement |
|---|---|---|
| **Payment Gateway** | One-time payments via cards / UPI / NB / EMI | Paytm JS Checkout (`/theia/api/v1/initiateTransaction`) |
| **Subscriptions** | Recurring payments via UPI Autopay / eMandate / Card SI | Paytm NATIVE_SUBSCRIPTION |
| **Payment Links** | Shareable URLs | Paytm `/link/create` |
| **Easy Split** | Marketplace split-settlement to multiple vendors | **No direct Paytm equivalent** — stays on Cashfree or build custom split logic |
| **Payouts** | Disburse money to bank accounts / UPI | **No direct Paytm equivalent** — keep Cashfree or move to a payouts-specific PSP |
| **Auto-collect / Virtual Accounts** | Customer-specific virtual UPI / bank accounts | Paytm Dynamic QR is the nearest, not a direct match |
| **Token Vault** | Card tokenization (network tokens / Issuer tokens) | Paytm handles tokenization internally; no separate vault API |

If the merchant only uses PG + Subscriptions, full migration to Paytm is feasible. If they rely on Easy Split or Payouts, plan a **partial migration**: PG flows move, the rest stays on Cashfree until Paytm ships an equivalent.

---

## Concepts mapping

| Cashfree term | Paytm term | Notes |
|---|---|---|
| `app_id` (X-Client-Id) | `MID` | Identifier |
| `secret_key` (X-Client-Secret) | `MERCHANT_KEY` | Signing secret |
| `order_id` (merchant-issued) | `orderId` (merchant-issued) | Same direction — both expect you to generate |
| `cf_order_id` (Cashfree-issued) | `TXNID` (Paytm-issued) | Per-order PSP id |
| `payment_session_id` | `txnToken` | Single-use, 15-min TTL on Paytm |
| `cf_payment_id` (per-payment) | `TXNID` (per-payment) | Used for refunds + status |
| `x-api-version` header | (none) | Paytm endpoints are implicitly versioned |
| `order_meta.return_url` | `callbackUrl` | Where to send the user after payment |
| `order_meta.notify_url` | (configure on dashboard, not per-order) | Paytm webhook URL is global per MID |
| `customer_details.customer_id` | `userInfo.custId` | Sanitize to `[A-Za-z0-9_@-]` for Paytm |

---

## Auth model — every API call

### Cashfree

Two custom headers on every request:

```
x-client-id:     <APP_ID>
x-client-secret: <SECRET_KEY>
x-api-version:   2023-08-01
Content-Type:    application/json
```

```js
fetch("https://api.cashfree.com/pg/orders", {
  method: "POST",
  headers: {
    "x-client-id": process.env.CASHFREE_APP_ID,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY,
    "x-api-version": "2023-08-01",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ order_id, order_amount, order_currency: "INR", customer_details }),
});
```

### Paytm

Body checksum, no custom headers:

```js
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

fetch(`${PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ head: { signature }, body }),
});
```

The two patterns are not interchangeable. Delete the Cashfree auth helper during cutover and use `paytmchecksum`.

---

## One-time payment - full per-step diff

### Step 1: server creates order

| | Cashfree | Paytm |
|---|---|---|
| Endpoint | `POST https://api.cashfree.com/pg/orders` (prod) / `https://sandbox.cashfree.com/pg/orders` (test) | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=...&orderId=...` |
| Auth | `x-client-id` + `x-client-secret` + `x-api-version` headers | Body `head.signature` |
| Amount | `order_amount: 100.00` (number, rupees) | `txnAmount.value: "100.00"` (string, two-decimal, rupees) |
| Currency | `order_currency: "INR"` | `txnAmount.currency: "INR"` |
| Order id | `order_id` (your id, mandatory) | `orderId` (your id, mandatory, charset `[A-Za-z0-9_@-]`, ≤ 50) |
| Customer | `customer_details: { customer_id, customer_phone, customer_email }` | `userInfo: { custId, mobile, email }` |
| Returns | `{ payment_session_id, order_id, cf_order_id, order_status: "ACTIVE", ... }` | `{ body: { txnToken, resultInfo: {...} } }` |

**Code diff:**

```js
// Cashfree
import { Cashfree } from "cashfree-pg";
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment = Cashfree.Environment.PRODUCTION;

const { data } = await Cashfree.PGCreateOrder("2023-08-01", {
  order_id: "ORD_001",
  order_amount: 100.00,
  order_currency: "INR",
  customer_details: { customer_id: "CUST_1", customer_phone: "9999999999", customer_email: "buyer@example.com" },
});
// data.payment_session_id -> pass to frontend
```

```js
// Paytm
const orderId = "ORD_001";
const body = {
  requestType: "Payment",
  mid: MID,
  websiteName: WEBSITE_NAME,
  orderId,
  callbackUrl,
  txnAmount: { value: "100.00", currency: "INR" },
  userInfo: { custId: "CUST_1", mobile: "9999999999", email: "buyer@example.com" },
};
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);
const r = await fetch(...);
const txnToken = (await r.json()).body.txnToken;
```

### Step 2: frontend payment UI

| | Cashfree | Paytm |
|---|---|---|
| Loader | `<script src="https://sdk.cashfree.com/js/v3/cashfree.js">` | `<script src="{PAYTM_PG_DOMAIN}/merchantpgpui/checkoutjs/merchants/{MID}.js">` |
| Open | `new Cashfree({ mode: "production" }).checkout({ paymentSessionId, redirectTarget: "_self" })` | `Paytm.CheckoutJS.init({ data: { orderId, token, tokenType, amount }, handler, merchant: { redirect: true } }).then(invoke)` |
| Result delivery | Browser redirects to `return_url` with query params (`?order_id=...`) | Browser POSTs to `callbackUrl` with form-encoded fields (`STATUS`, `ORDERID`, `TXNID`, `CHECKSUMHASH`) |

Paytm's `onLoad` trap doesn't exist on Cashfree — new bug class to watch for after migration. See `js-checkout` skill § Step 3.

### Step 3: server-side verification

| | Cashfree | Paytm |
|---|---|---|
| Endpoint | `GET /pg/orders/:order_id` | `POST /v3/order/status` |
| Authentication | Same `x-client-id` + `x-client-secret` headers | `head.signature` over body |
| Status field | `order.order_status: "PAID" / "ACTIVE" / "EXPIRED" / "TERMINATED"` | `body.resultInfo.resultStatus: "TXN_SUCCESS" / "TXN_FAILURE" / "PENDING"` |
| Per-payment detail | `GET /pg/orders/:order_id/payments` | `/v3/order/status` returns the latest payment inline |

**Critical:** the `head` for Paytm's `/v3/order/status` has ONLY `signature` — no `tokenType`, no `timestamp`. Don't mix in fields from other Paytm endpoints.

---

## Subscriptions - full mapping

### Cashfree model

```
1. Create Plan (optional; per-customer pricing fine without)
2. POST /pg/subscriptions
   { subscription_id, customer_details, plan_details (or inline amount + frequency),
     authorization_details, subscription_meta: { return_url, notify_url } }
3. Returns auth_link or session_id for customer consent
4. Customer authorizes (UPI Autopay / NACH / Card SI)
5. Cashfree auto-debits per schedule
6. Webhook per cycle: SUBSCRIPTION_PAYMENT_WEBHOOK
```

### Paytm model

```
1. NO plans concept - amount lives on the subscription itself
2. POST /subscription/create with NATIVE_SUBSCRIPTION
   - head: { clientId, channelId, signature }
   - flat body (no subscriptionDetails wrapper)
3. Returns txnToken
4. Open Paytm.CheckoutJS for mandate consent
5. Paytm auto-debits per schedule
6. Webhook per cycle: txnType: "SUBSCRIPTION_DEBIT"
```

### Field mapping

| Cashfree | Paytm | Notes |
|---|---|---|
| `plan_details.plan_id` | (no equivalent) | Bake amount into subscription create body |
| `plan_details.plan_max_amount` | `txnAmount.value` | Maximum debit per cycle |
| `plan_details.plan_max_cycles` | `subscriptionExpiryDate` | Cashfree counts cycles; Paytm uses an end date |
| `plan_details.plan_intervals` | (use frequency math) | Multiply * frequency to derive expiry |
| `plan_details.plan_type` | `subscriptionAmountType: "FIX" / "VARIABLE"` | `PERIODIC` → `FIX`; `ON_DEMAND` → `VARIABLE` |
| `authorization_details.authorization_amount` | `txnAmount.value` on the initial create call | Mandate authorization amount (₹2 min for CC/DC) |
| `subscription_meta.return_url` | `callbackUrl` | Same purpose |
| `subscription_meta.notify_url` | (configure on dashboard) | Paytm webhook URL is global |
| `customer_details.customer_id` | `userInfo.custId` | Sanitize charset |

### Frequency mapping

| Cashfree | Paytm `subscriptionFrequency` + `subscriptionFrequencyUnit` |
|---|---|
| `plan_intervals: 1, plan_interval_type: "day"` | `1`, `DAY` |
| `1, "week"` | `7`, `DAY` (or `1`, `WEEK` if MID supports it) |
| `1, "month"` | `1`, `MONTH` |
| `1, "year"` | `1`, `YEAR` |

**Watch:** `subscriptionGraceDays` must be < cycle length on Paytm. Cashfree has no such constraint. See `subscriptions` skill § default rules.

### Event mapping

```
Cashfree event                              Paytm webhook body
──────────────                              ──────────────────
SUBSCRIPTION_AUTH_SUCCESS               →   txnType: "SUBSCRIPTION_INIT", status: TXN_SUCCESS
SUBSCRIPTION_PAYMENT_SUCCESS            →   txnType: "SUBSCRIPTION_DEBIT", status: TXN_SUCCESS
SUBSCRIPTION_PAYMENT_FAILED             →   txnType: "SUBSCRIPTION_DEBIT", status: TXN_FAILURE
SUBSCRIPTION_CANCELLED                  →   txnType: "SUBSCRIPTION_CANCEL", status: TXN_SUCCESS
```

---

## Payment Links - mapping

| | Cashfree | Paytm |
|---|---|---|
| Create | `POST /pg/links` | `POST /link/create` |
| Body | `{ link_id, link_amount, link_currency, customer_details, link_meta, link_notify, link_purpose }` | `{ body: { linkType, linkName, linkDescription, amount, customerContact: {...}, sendSms, sendEmail } }` |
| Identifier | `link_id` (string) | `linkId` (JSON **number**) |
| Status check | `GET /pg/links/:link_id` | `POST /link/fetch` |
| Transaction list | (returned inline with link) | `POST /link/fetchTransaction` (NOT `/v3/order/status`) |
| Status field | `link_status: "ACTIVE" / "PAID" / "EXPIRED" / "CANCELLED"` | dual-shape: `linkStatus: "ACTIVE"` OR `isActive: true` |
| Transaction order status | `transaction.payment_status: "SUCCESS" / "FAILED"` | dual-shape: `orderStatus: "SUCCESS"` OR `"TXN_SUCCESS"` |
| Cancel | `POST /pg/links/:link_id/cancel` | `POST /link/expire` |
| Resend | (handled via Cashfree dashboard) | `POST /link/resendNotification` |

**Charset gotcha** unique to Paytm: `linkName` is alphanumerics ONLY (no spaces — error 5007). Cashfree accepts spaces. Sanitize when porting.

---

## Refunds - mapping

| | Cashfree | Paytm |
|---|---|---|
| Create | `POST /pg/orders/:order_id/refunds` | `POST /refund/apply` |
| Body | `{ refund_amount, refund_id, refund_note, refund_speed: "STANDARD" / "INSTANT" }` | `{ body: { txnType: "REFUND", orderId, txnId, refId, refundAmount } }` |
| Refund id | You provide `refund_id`; Cashfree returns `cf_refund_id` | You provide `refId`; Paytm returns `refundId` |
| Idempotency | Reuse same `refund_id` (Cashfree dedups per `refund_id`) | Reuse same `refId` (Paytm dedups per `refId`) |
| Status | `GET /pg/orders/:order_id/refunds/:refund_id` | `POST /refund/status` |
| Webhook event | `REFUND_STATUS_WEBHOOK` (`type`) | Same `/paytm/webhook` with `txnType: "REFUND"` |
| Speed control | `refund_speed: "INSTANT"` available on some flows | Not configurable per refund |

---

## Webhooks - signature scheme deep dive

### Cashfree

```
HTTP POST /your/webhook
Headers:
  x-webhook-signature: <base64 HMAC-SHA256(timestamp + rawBody, secret_key)>
  x-webhook-timestamp: <epoch seconds>
  x-webhook-version:   <api version>
Body:
  { "type": "PAYMENT_SUCCESS_WEBHOOK_V2", "data": { ... }, "event_time": "..." }
```

Verification (concatenate timestamp before raw body, then HMAC):

```js
const ts = req.headers["x-webhook-timestamp"];
const expected = crypto
  .createHmac("sha256", CASHFREE_SECRET_KEY)
  .update(ts + rawBody)
  .digest("base64");
if (expected !== req.headers["x-webhook-signature"]) return res.status(401);
```

### Paytm

```
HTTP POST /your/webhook
Content-Type: application/json
Body:
  { "head": { "signature": "<hmac>" }, "body": { "mid", "orderId", "txnId", "status", ... } }
```

Verification (no timestamp, no headers):

```js
const valid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, parsed.head.signature);
if (!valid) return res.status(401);
```

**Key differences:**

1. Signature **header** vs **body field**.
2. Cashfree prepends `timestamp + rawBody` before HMAC; Paytm signs the **body bytes only** (no concatenation).
3. Cashfree uses **base64** encoding; Paytm encoding handled by the library.
4. Event types: Cashfree top-level `type` field; Paytm uses `body.txnType` + `body.status`.

### Event mapping

| Cashfree event `type` | Paytm `body.txnType` + `body.status` |
|---|---|
| `PAYMENT_SUCCESS_WEBHOOK_V2` | `SALE` (or absent), `TXN_SUCCESS` |
| `PAYMENT_FAILED_WEBHOOK_V2` | `SALE`, `TXN_FAILURE` |
| `PAYMENT_USER_DROPPED_WEBHOOK` | `SALE`, `TXN_FAILURE` |
| `REFUND_STATUS_WEBHOOK` | `REFUND`, `TXN_SUCCESS` / `TXN_FAILURE` |
| `SUBSCRIPTION_AUTH_SUCCESS` | `SUBSCRIPTION_INIT`, `TXN_SUCCESS` |
| `SUBSCRIPTION_PAYMENT_SUCCESS` | `SUBSCRIPTION_DEBIT`, `TXN_SUCCESS` |
| `SUBSCRIPTION_PAYMENT_FAILED` | `SUBSCRIPTION_DEBIT`, `TXN_FAILURE` |
| `SUBSCRIPTION_CANCELLED` | `SUBSCRIPTION_CANCEL`, `TXN_SUCCESS` |

### Retry behavior

| | Cashfree | Paytm |
|---|---|---|
| Retry window | ~24h, ~5 attempts with backoff | ~7 days, ~10 attempts |
| Stops on 2xx | Yes | Yes |
| Dedup expected | Yes — event has a unique `data.payment.cf_payment_id` (or refund id) | Yes — dedup on `(orderId, status)` or `(refId, status)` |

---

## Dual-write rollout pattern

Architecturally identical to the Razorpay sample (`migrate-from-razorpay/references/REFERENCE.md` § Dual-write). Two Cashfree-specific tweaks:

1. **Header auth differs from body auth** — your dual-write code has TWO different auth helpers: one that sets `x-client-id` / `x-client-secret` for Cashfree, one that generates `head.signature` for Paytm. Keep them isolated; don't try to share.
2. **API version pinning** — Cashfree forces you to send `x-api-version` and changes payload shape across versions. Pin Cashfree to a stable version (e.g. `2023-08-01`) for the duration of the dual-write period, then drop the dependency on cutover.

Reference dual-write impl: `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Swap the Razorpay branch for Cashfree's `Cashfree.PGCreateOrder()` call.

---

## Cutover checklist

When canary at 100% is stable for ≥ 2 weeks:

- [ ] All new PG / Subscription orders going to Paytm.
- [ ] Cashfree credentials still configured but **only** used for refunds + disputes on legacy transactions.
- [ ] Cashfree webhooks still wired (you'll receive refund webhooks for in-flight refunds).
- [ ] Refund script knows which gateway each historical order used (`psp_used: "cashfree" | "paytm"`).
- [ ] **If using Easy Split / Payouts** — those continue running on Cashfree. Document the split clearly so future engineers don't accidentally migrate them.
- [ ] **Active subscription mandates on Cashfree** continue debiting until naturally expired. Don't cancel mid-cycle.
- [ ] Customer support team trained on Paytm dashboard.
- [ ] Settlement reconciliation team aware of timing differences.
- [ ] Keep Cashfree keys live for **90 days minimum** (longer if you have multi-quarter subscription mandates).
- [ ] After 90 days of clean Paytm operation, rotate Cashfree keys or cancel the contract.

---

## Common pitfalls when porting

| Bug seen in production | Cause | Fix |
|---|---|---|
| Checksum mismatches everywhere on Paytm | Developer reused Cashfree's webhook HMAC formula (`timestamp + body`) | Use `PaytmChecksum.verifySignature(rawBody, KEY, sig)` — no timestamp prepending |
| API requests rejected with 401 | Sent `x-client-id` / `x-client-secret` headers to Paytm endpoints | Drop the headers; Paytm uses body checksum |
| Amount off by 100x | Cashfree accepts decimals; some integrations cast to int | Two-decimal string everywhere for Paytm |
| Subscription "cycles wrong" | Cashfree's `plan_max_cycles` ignored, no Paytm equivalent | Translate to `subscriptionExpiryDate` based on cycle * frequency |
| Refund "duplicate" error | Reusing different refund ids per retry | Use the same `refId` for retries; Paytm dedups |
| Webhook signature always fails | Verifying `x-webhook-signature` header (Cashfree muscle memory) | Read `body.head.signature` instead |
| Settlement amounts off | Cashfree deducts fees inline (or via Easy Split); Paytm settles gross then debits | Reconcile gross + fee separately for the cutover quarter |
| Easy Split logic broken | Easy Split was Cashfree's product; no Paytm equivalent | Keep Easy Split on Cashfree, or build custom split logic on top of Paytm payments |

---

## Other source gateways

This skill is Cashfree-specific. Equivalent skills:

- `migrate-from-razorpay` (shipped)
- `migrate-from-payu` (shipped)
- `migrate-from-juspay` (next)
- `migrate-from-ccavenue` (planned)
- `migrate-from-billdesk` (planned)
