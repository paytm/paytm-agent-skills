# Juspay → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping, orchestrator-vs-PG mental model, ExpressCheckout / HyperSDK / HyperCheckout breakdown, dual-write rollout caveats, cutover checklist.

---

## Juspay product surface

Juspay has several products. Migration scope depends on which the merchant uses:

| Juspay product | What it does | Paytm replacement |
|---|---|---|
| **ExpressCheckout API** | REST API to create orders, fetch status, refunds | Paytm REST API (`/theia/api/v1/initiateTransaction`, `/v3/order/status`, `/refund/apply`) |
| **HyperCheckout (web)** | Hosted overlay iframe served from `juspay.in/hyperloader/*`, picks PG dynamically | Paytm JS Checkout |
| **HyperSDK (Android / iOS)** | Native SDK with dynamic config, picks PG at runtime | Paytm All-in-One SDK or Custom SDK |
| **Smart Routing** | Auto-routes to highest-success PG per transaction | **No Paytm equivalent** — Paytm is one PG; lost feature |
| **Smart Retry** | Auto-retries on a different PG when first fails | **No equivalent** — Paytm retries on Paytm |
| **Juspay Safe (risk)** | Fraud / chargeback prevention layer | Paytm has its own risk engine; not feature-equal |
| **Hyper Checkout Lite** | A more lightweight web overlay | Paytm JS Checkout |
| **Settlement Workflow / Reconciliation** | Aggregated settlement across PGs | Paytm settles only its own transactions |

Migrating means accepting the loss of Smart Routing + Smart Retry + cross-PG settlement. Plan with stakeholders.

---

## Pre-migration questions

Before generating any code, ask the merchant:

1. **Are you using Juspay only for one PG today, or are multiple PGs active behind it?**
   - One PG → migration is a clean swap, no value lost.
   - Multiple PGs → understand which metrics depend on smart-routing before proceeding.
2. **What is your current success rate, and what is the Paytm-only success rate baseline?**
   - Get this from your Juspay dashboard. Sub-rate on Paytm alone might be lower; quantify the gap before cutover.
3. **Are you using Juspay Safe (risk)?**
   - If yes, plan a separate risk-engine evaluation. Don't assume Paytm matches.
4. **Are you using cross-PG settlement / reconciliation?**
   - Plan the new accounting workflow upfront.
5. **What is your retry behavior today?**
   - Juspay retries cross-PG transparently. Paytm-direct retries are within Paytm.

---

## Concepts mapping

| Juspay term | Paytm term | Notes |
|---|---|---|
| `merchant_id` | `MID` | Identifier |
| `api_key` | `MERCHANT_KEY` | Signing secret (also used as HTTP Basic password) |
| `order_id` (merchant-issued) | `orderId` (merchant-issued) | Same direction |
| `client_auth_token` | (no direct equivalent — Paytm uses `txnToken` for the SDK/JS flow) | Juspay's token includes routing decisions; don't try to map 1:1 |
| `gateway_reference_id` | `TXNID` | Per-payment id on the chosen PG |
| `payment_method` | `paymentMode` (read from callback) | Card / UPI / NB / Wallet (Paytm doesn't expose Wallet) |
| `return_url` | `callbackUrl` | Same purpose |
| `udf1`...`udf10` | (no UDF concept) | Move to `userInfo.extraParamsMap` or your own DB |
| `webhook_secret` | `MERCHANT_KEY` (reused for webhook signing) | Paytm reuses the same key for API + webhook |

---

## Auth model — every API call

### Juspay

HTTP Basic Auth — `api_key` as the username, password is empty:

```js
const headers = {
  "Authorization": "Basic " + Buffer.from(JUSPAY_API_KEY + ":").toString("base64"),  // colon with empty password
  "Content-Type": "application/json",
  "x-merchantid": JUSPAY_MERCHANT_ID,
};

await fetch("https://api.juspay.in/orders", {
  method: "POST",
  headers,
  body: JSON.stringify({ order_id: "ORD_001", amount: 100.00, ... }),
});
```

### Paytm

Body checksum, no HTTP auth:

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

await fetch(`${PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ head: { signature }, body }),
});
```

Delete the HTTP Basic Auth helper during cutover. Use `paytmchecksum`.

---

## One-time payment - full per-step diff

### Step 1: server creates order

| | Juspay | Paytm |
|---|---|---|
| Endpoint | `POST https://api.juspay.in/orders` (prod) / `https://sandbox.juspay.in/orders` (test) | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=...&orderId=...` |
| Auth | HTTP Basic + `x-merchantid` header | Body `head.signature` |
| Amount | `amount: 100.00` (number, rupees) | `txnAmount.value: "100.00"` (string, two-decimal, rupees) |
| Order id | `order_id` (mandatory) | `orderId` (mandatory, charset `[A-Za-z0-9_@-]`, ≤50) |
| Customer | `customer_id`, `customer_email`, `customer_phone` (flat) | `userInfo: { custId, email, mobile }` (envelope) |
| Returns | `{ order_id, client_auth_token, status: "NEW", payment_links: {...} }` | `{ body: { txnToken, resultInfo: {...} } }` |

**Code diff:**

```js
// Juspay
const r = await fetch("https://api.juspay.in/orders", {
  method: "POST",
  headers: {
    "Authorization": "Basic " + Buffer.from(JUSPAY_API_KEY + ":").toString("base64"),
    "x-merchantid": JUSPAY_MERCHANT_ID,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    order_id: "ORD_001",
    amount: 100.00,
    customer_id: "CUST_1",
    customer_email: "buyer@example.com",
    customer_phone: "9999999999",
    return_url: "https://yoursite.com/return",
  }),
});
const { order_id, client_auth_token } = await r.json();
```

```js
// Paytm
const orderId = "ORD_001";
const body = {
  requestType: "Payment",
  mid: MID,
  websiteName: WEBSITE_NAME,
  orderId,
  callbackUrl: "https://yoursite.com/paytm/callback",
  txnAmount: { value: "100.00", currency: "INR" },
  userInfo: { custId: "CUST_1", email: "buyer@example.com", mobile: "9999999999" },
};
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);
const r = await fetch(...);
const txnToken = (await r.json()).body.txnToken;
```

### Step 2: frontend — web

| | Juspay HyperCheckout | Paytm JS Checkout |
|---|---|---|
| Loader | `<script src="https://api.juspay.in/hyperloader.js">` | `<script src="{PAYTM_PG_DOMAIN}/merchantpgpui/checkoutjs/merchants/{MID}.js">` |
| Bootstrap | `hyperServices.openIframe({ order_id, client_auth_token, ... })` | `Paytm.CheckoutJS.init({ data: { orderId, token, tokenType, amount }, handler, merchant: { redirect: true } }).then(invoke)` |
| Customer return | Browser redirects to `return_url` with query params | Paytm POSTs callback to `callbackUrl` |

See `js-checkout` skill for the Paytm-side pattern (static loader recommended, `redirect: true` for safety).

### Step 2 (alt): frontend — mobile

| | Juspay HyperSDK | Paytm All-in-One SDK |
|---|---|---|
| Android setup | `implementation "in.juspay:hypersdk:..."` | `implementation "com.paytm.appinvokesdk:appinvokesdk:..."` |
| iOS setup | `pod 'HyperSDK'` | `pod 'AppInvokeSDK'` |
| Init | `HyperServices(activity)` | `new TransactionManager(PaytmOrder, callback)` |
| Start payment | `.process(processPayload)` with `client_auth_token` | `.startTransaction(activity, REQUEST_CODE)` |
| Callback | `HyperPaymentsCallback.onEvent(event, data)` | `PaytmPaymentTransactionCallback.onTransactionResponse(bundle)` |

See `all-in-one-sdk` or `custom-sdk` skill for full Paytm mobile patterns.

### Step 3: source-of-truth check

| | Juspay | Paytm |
|---|---|---|
| Endpoint | `GET /orders/:order_id` | `POST /v3/order/status` |
| Auth | Same HTTP Basic | `head.signature` over body |
| Status field | `status: "CHARGED" / "AUTHORIZATION_FAILED" / "PENDING_VBV" / ...` | `body.resultInfo.resultStatus: "TXN_SUCCESS" / "TXN_FAILURE" / "PENDING"` |
| Status enum | Juspay has ~15 status values (per-stage detail) | Paytm has 3 main values; details in resultCode |

Map Juspay statuses to Paytm equivalents during dual-write reconciliation:

| Juspay `status` | Paytm `resultStatus` |
|---|---|
| `CHARGED` | `TXN_SUCCESS` |
| `AUTHORIZATION_FAILED`, `AUTHENTICATION_FAILED`, `FAILURE` | `TXN_FAILURE` |
| `PENDING_VBV`, `STARTED`, `AUTHORIZING`, `NEW` | `PENDING` |
| `JUSPAY_DECLINED`, `VOID_FAILED` | `TXN_FAILURE` |
| `VOIDED`, `REFUNDED` | (separate refund state; not a payment state) |

---

## Refunds - full mapping

| | Juspay | Paytm |
|---|---|---|
| Create | `POST /orders/:order_id/refunds` | `POST /refund/apply` |
| Body | `{ unique_request_id, amount }` | `{ body: { txnType: "REFUND", orderId, txnId, refId, refundAmount } }` |
| Refund id | You provide `unique_request_id`; Juspay returns `refund.id` | You provide `refId`; Paytm returns `refundId` |
| Idempotency | Reuse same `unique_request_id` for retries | Reuse same `refId` |
| Status | `GET /orders/:order_id/refunds/:refund_id` | `POST /v2/refund/status` |
| Webhook event | Order webhook with `status: "REFUNDED"` / `"REFUND_FAILED"` | `/paytm/webhook` with `txnType: "REFUND"` |
| Multiple refunds per order | Yes (partial allowed) | Yes (partial allowed, cumulative ≤ original) |

---

## Webhooks - signature scheme

### Juspay

```
HTTP POST /your/webhook
Headers:
  x-juspay-signature: <hex HMAC-SHA256(rawBody, webhook_secret)>
  Content-Type: application/json
Body:
  { "event": "ORDER_SUCCEEDED", "content": { "order": { ... } }, "timestamp": "..." }
```

Verification:
```js
const expected = crypto.createHmac("sha256", JUSPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
if (expected !== req.headers["x-juspay-signature"]) return res.status(401);
```

(Header name varies between Juspay environments — check the merchant's dashboard config. Some accounts use `x-juspay-signature`, some `x-hmac-signature`.)

### Paytm

```
HTTP POST /your/webhook
Content-Type: application/json
Body: { "head": { "signature": "..." }, "body": { "mid", "orderId", "status", ... } }
```

```js
const valid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, parsed.head.signature);
if (!valid) return res.status(401);
```

**Key differences:**

1. Header vs body-field signature.
2. Juspay uses **hex** encoding; Paytm encoding handled by library.
3. Juspay events are top-level `event` string; Paytm uses `body.txnType` + `body.status`.

### Event mapping

| Juspay `event` | Paytm `body.txnType` + `body.status` |
|---|---|
| `ORDER_SUCCEEDED` | `SALE` (or absent), `TXN_SUCCESS` |
| `ORDER_FAILED` | `SALE`, `TXN_FAILURE` |
| `ORDER_REFUNDED` | `REFUND`, `TXN_SUCCESS` |
| `ORDER_REFUND_FAILED` | `REFUND`, `TXN_FAILURE` |
| `TXN_CREATED`, `TXN_CHARGED` | `SALE`, `PENDING` / `TXN_SUCCESS` |

---

## Dual-write rollout pattern

The Razorpay dual-write architecture (`migrate-from-razorpay/references/REFERENCE.md` § Dual-write) applies, with **two Juspay-specific tweaks**:

1. **Success-rate parity check is critical.** Because Juspay's value-add is multi-PG routing, you may see a meaningful **success-rate drop** on the Paytm-direct branch. Don't ramp the canary past 25% until you've validated the gap is acceptable to the business.
2. **HyperSDK is heavier than Paytm All-in-One.** On mobile, the canary decision needs to be made at app startup (before instantiating either SDK) — if you bundle both SDKs, app size doubles. Consider feature-flagging the SDK choice via a config endpoint instead.

Reference dual-write impl: `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Adapt the source-PSP branch to call Juspay's `/orders` with HTTP Basic auth.

---

## Cutover checklist

When canary at 100% is stable for ≥ 4 weeks (longer than other migrations because of success-rate variance):

- [ ] Success rate at parity with Juspay baseline (or business-accepted regression).
- [ ] All new orders going to Paytm direct.
- [ ] Juspay credentials still configured but **only** used for status checks on legacy orders + processing refunds for already-charged transactions.
- [ ] If Juspay handled Smart Retry across PGs, document the new retry policy (within Paytm only) for ops.
- [ ] Risk / fraud rules ported to Paytm's risk engine if you used Juspay Safe.
- [ ] Customer support team trained on Paytm dashboard.
- [ ] Settlement reconciliation team aware of new schedule (Paytm direct vs Juspay-aggregated).
- [ ] Keep Juspay live for **120 days** to clear in-flight refund / dispute tail.
- [ ] After 120 days, rotate keys + cancel the contract.

---

## Common pitfalls when porting

| Bug seen in production | Cause | Fix |
|---|---|---|
| 401 on every Paytm API call | Developer ported Juspay's `Authorization: Basic` header to Paytm | Drop the header; Paytm uses body checksum |
| `txnToken` not working in HyperSDK | Tried to feed Paytm's `txnToken` into HyperSDK | HyperSDK is gone; use Paytm's SDK |
| Webhook signature always fails | Ported Juspay's `x-juspay-signature` header check to Paytm | Read `body.head.signature` in JSON |
| Success rate dropped sharply | Lost Juspay Smart Routing; Paytm alone is the new floor | Expected — validate the gap is acceptable; alternative is to keep Juspay |
| Amount off by 100x | Juspay accepts decimals; some integrations cast to int paise | Paytm needs two-decimal string `"100.00"` |
| UDF data lost | UDFs (`udf1-udf10`) carried business state on Juspay | Move to `userInfo.extraParamsMap` or your own DB |
| Refund "duplicate" | Reused `unique_request_id` from Juspay as Paytm `refId` (same value across attempts of same refund is correct, but same value across DIFFERENT refunds is wrong) | Generate fresh `refId` per refund attempt |
| Mobile app size doubled | Both HyperSDK + Paytm SDK bundled during dual-write | Feature-flag SDK choice via config endpoint, not both bundled |

---

## Other source gateways

- `migrate-from-razorpay` (shipped)
- `migrate-from-payu` (shipped)
- `migrate-from-cashfree` (shipped)
- `migrate-from-ccavenue` (planned)
- `migrate-from-billdesk` (planned)
