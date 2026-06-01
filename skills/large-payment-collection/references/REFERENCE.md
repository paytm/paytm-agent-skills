# Paytm Large Payment Collection — Reference

> _Companion to **`SKILL.md`** — load this file alongside `SKILL.md`, never instead of it._

Large Payment Collection (a.k.a. Paytm Bank Transfer) lets merchants accept high-ticket payments via **NEFT / RTGS / IMPS** by issuing each customer a unique 18-character **Virtual Account Number (VAN)**. Paytm auto-reconciles each inbound bank transfer to the correct VAN and fires a signed webhook with full remitter details. Settlement to the merchant's bank account is **T+1**.

Reference: <https://www.paytmpayments.com/docs/large-payment-collection?ref=enterpriseSolutions>

> **⚠️ READ THIS FIRST — common mistakes that cause silent failures and reconciliation gaps:**
>
> 1. **`vanId` is always 18 chars; the first 4 chars are always `"PPSL"`.** Don't reconstruct from `prefix + identificationNo` : always store the full `vanId` from the API response.
> 2. **IFSC is always `UTIB0CCH274`. Beneficiary name is always `Paytm Payments Services Ltd.`** Display exactly what the API returns : never hardcode these values.
> 3. **`requestId` is the idempotency key for `/van/create`.** Replay the same `requestId` on retry — you'll get back the original VAN, not a duplicate. A fresh UUID per retry creates duplicate VANs and wastes your prefix space.
> 4. **TPV is hard-capped at 10 active accounts per VAN.** Adding an 11th fails — disable an existing one first via `/van/update` with `removeThirdPartyValidation`.
> 5. **Refunds need `remitterAccount` + `remitterIFSC` from the inbound transfer.** Some banks (older SFMS messages, a few cooperative banks) don't send them — refund API returns `01000009` and you must settle out-of-band. There is no Paytm-side workaround.
> 6. **Max refund per `/van/refund` call is ₹2L.** Split larger refunds into multiple calls with distinct `refundId`s. The API does not auto-split.
> 7. **Webhooks must be ACKed with HTTP 200 within 5s.** Non-2xx triggers retries with exponential backoff. Process async; ACK first.
> 8. **`amount` in API & webhook payloads is a string of rupees (no paise scaling).** `"50000"` means ₹50,000.00, not ₹500.00. Different from JS Checkout's `txnAmount.value` convention — don't share parsing code blindly.
> 9. **`transactionMode` is one of `NEFT | RTGS | IMPS | UPI`.** UPI only appears under the Checkout flow (order-based VANs). If you see UPI on a Non-Checkout VAN, raise a ticket.
> 10. **Settlement is T+1.** IMPS hits your webhook in seconds, but money lands T+1. Don't promise instant cash availability to finance / ops.
> 11. **Verify the response signature on every webhook AND every API response.** Paytm signs both directions; failing to verify exposes you to spoofed credit notifications.

---

## Onboarding prerequisites

1. Raise a Large Payment Collection activation ticket from the Paytm merchant dashboard (or via your account manager).
2. Provide:
   - Your **4-character merchant prefix** (e.g. `ABCD`). Becomes positions 3–6 of every VAN you ever issue. Choose carefully — irreversible.
   - **VAN customization mode:** `MERCHANT_MANAGED` (you supply `identificationNo`) or `PAYTM_MANAGED` (Paytm derives it from the customer's validated mobile).
   - **Order timeout window** for the Checkout flow (e.g. 3600 seconds).
   - **TPV requirement**: yes for BFSI / SEBI-regulated entities, optional otherwise.
3. Configure your webhook URL for `PAYMENT_SUCCESS` / `PAYMENT_FAILURE` / `REFUND_SUCCESS` / `REFUND_FAILURE` events.
4. Test on staging using Paytm's payment simulator utility (you provide remitter name / account / IFSC / VAN / amount; Paytm fires the webhook).
5. **Request Bank Transfer mode (NEFT/RTGS/IMPS) activation on the MID separately from the general Large Payment Collection activation.** These are two distinct switches. Error `2001` ("Bank Transfer not supported") means switch #2 is off — contact the Paytm integration team; no code change will fix this.
6. Store all credentials in environment variables : never hardcode:

   ```
   PAYTM_MID=your_mid
   PAYTM_MERCHANT_KEY=your_key
   PAYTM_ENVIRONMENT=staging        # or production
   PAYTM_WEBSITE_NAME=WEBSTAGING    # or DEFAULT for production
   PAYTM_MERCHANT_PREFIX=ABCD
   ```

   Load `.env` with an explicit path to avoid directory mismatch issues:

   ```js
   dotenv.config({ path: path.join(__dirname, '.env') });
   ```

---

## Two flows in detail

### Non-Checkout flow — Pre-created VANs (ongoing collections)

One VAN per customer, lives forever (until you `DISABLE` it). Payer can pay any amount, any number of times. Best for:

- School / college fees (one VAN per student roll number)
- Distributor / dealer collections (one VAN per dealer)
- B2B invoicing where the customer pays multiple invoices to the same VAN
- BFSI investments (one VAN per investor, with TPV)

Create the VAN at customer onboarding, share IFSC + VAN + beneficiary on every invoice / fee notice. Match incoming webhooks against your customer ledger by `vanId` (or `udf.customerId`).

### Checkout flow — Order-based VANs (single-shot, amount-matched)

VAN created per order, expires after `orderTimeout`. Payer **must pay exactly `txnAmount`** within the window. Best for:

- Hotel / travel bookings > ₹2L
- Auction wins
- Insurance premium for a specific policy term
- Any single-order flow where you'd otherwise show "NEFT / RTGS to this account" alongside card / UPI options

Under-payment or over-payment is **auto-refunded** by Paytm; late payment (after `orderTimeout`) is also auto-refunded. You don't need to script the refund.

---

## Endpoints — full request / response field tables

**Non-Checkout flow uses a single `vanproxy` endpoint** — the `body` discriminates the operation. All requests must be wrapped in a `head` + `body` envelope.

| Environment | Endpoint |
|---|---|
| Staging | `POST https://securestage.paytmpayments.com/vanproxy/api/v1/van?mid={MID}` |
| Production | `POST https://secure.paytmpayments.com/vanproxy/api/v1/van?mid={MID}` |

### vanproxy Request Head — required fields

| Field | Value |
|---|---|
| `clientId` | `"C11"` (fixed) |
| `version` | `"v1"` (fixed) |
| `requestTimestamp` | `Date.now().toString()` — epoch ms as string |
| `channelId` | `"WEB"` (fixed) |
| `tokenType` | `"CHECKSUM"` (fixed) |
| `token` | `PaytmChecksum.generateSignature(JSON.stringify(body), merchantKey)` |

> ⚠️ The checksum field is **`token`**, NOT `signature`. Naming it `signature` returns `2002 CheckSum Validation Failure`. Omitting any of the five fixed fields above also returns `2002`.

### 1. Create VAN

```
POST {STAGING_OR_PROD}/vanproxy/api/v1/van?mid={MID}
```

Request body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `mid` | string | ✅ | Your Paytm MID |
| `requestId` | string | ✅ | **Idempotency key.** Replay returns original response. |
| `vanDetails` | array | ✅ | 1–10 VAN objects per call |
| `vanDetails[].merchantPrefix` | string(4) | ✅ | Must match your onboarded prefix |
| `vanDetails[].identificationNo` | string(10) | conditional | Required for `MERCHANT_MANAGED`; omit for `PAYTM_MANAGED` |
| `vanDetails[].purpose` | string | optional | Free-text, shown in dashboard |
| `vanDetails[].customerDetails` | array | ✅ | Nested customer info — at least one entry |
| `vanDetails[].customerDetails[].customerName` | string | ✅ | Customer / business name |
| `vanDetails[].customerDetails[].customerMobile` | string | ✅ | 10-digit mobile |
| `vanDetails[].customerDetails[].customerEmail` | string | optional | |
| `vanDetails[].userDefinedFields` | object | optional | KV pairs — round-tripped on every webhook |
| `vanDetails[].tpvList` | array | conditional | Required if TPV is on for your MID. Max 10 entries. |
| `vanDetails[].tpvList[].bankAccount` | string | ✅ (when TPV) | Whitelisted payer account |
| `vanDetails[].tpvList[].ifsc` | string | ✅ (when TPV) | Whitelisted payer IFSC |

> The checksum goes in `head.token`, NOT in the body. See vanproxy head field table above.

Response (success):

```json
{
  "resultCode": "0000",
  "resultMsg": "SUCCESS",
  "requestId": "req_2024_01_15_inv12345",
  "vanDetails": [
    {
      "responseStatus": "SUCCESS",
      "van": "PPSLABCD1234567890",
      "merchantPrefix": "ABCD",
      "identificationNo": "1234567890",
      "ifscCode": "UTIB0CCH274",
      "beneficiaryName": "Paytm Payments Services Ltd.",
      "status": "ACTIVE",
      "createdDate": "2024-01-15T10:30:00Z"
    }
  ]
}
```

> ⚠️ The VAN number is returned as `van`, NOT `vanId`, in the vanproxy Create VAN response. This differs from the Checkout flow (`/initiateTransaction`) which uses `vanId`. Always normalize in code: `const vanId = vanEntry.van || vanEntry.vanId;` — using only `vanEntry.vanId` returns `undefined` silently.

Response (per-entry failure):

```json
{
  "resultCode": "0000",
  "resultMsg": "SUCCESS",
  "vanDetails": [
    {
      "responseStatus": "FAILURE",
      "errorCode": "4010",
      "errorMessage": "Already exists"
    }
  ]
}
```

> ⚠️ **Always check `vanDetails[i].responseStatus`.** Outer `resultCode: "0000"` only means the API call was received — VAN creation may still have failed per-entry. Checking only the outer level silently treats failures as successes.

### 2. Query VAN (idempotency check)

```
POST {BASE}/van/query
```

Request: `mid`, `requestId`, `signature`. Returns the original Create-VAN response for that `requestId`. Use this when a Create call times out — don't blindly retry, query first.

### 3. Update VAN — disable / TPV management

```
POST {BASE}/van/update
```

Request:

| Field | Type | Required | Notes |
|---|---|---|---|
| `mid` | string | ✅ | |
| `vanId` | string(16) | ✅ | Full 16-char VAN |
| `action` | enum | optional | `DISABLE` (terminal — VAN stops accepting payments) |
| `addThirdPartyValidation` | array | optional | Add bank accounts to TPV list (cap = 10) |
| `removeThirdPartyValidation` | array | optional | Remove bank accounts from TPV list |
| `signature` | string | ✅ | |

You cannot re-enable a `DISABLED` VAN — create a new one.

### 4. VAN List

```
POST {BASE}/van/list
```

Paginated. Request: `mid`, `pageNumber`, `pageSize`, optional `status` filter (`ACTIVE` / `DISABLED`), `signature`. Returns `vanList[]` with `vanId`, `status`, `entityName`, `createdDate` plus `totalCount` and `pageNumber`.

### 5. Order List (inbound payments)

```
POST {BASE}/van/orderList
```

Request: `mid`, `startDate`, `endDate` (ISO date, ≤ 31 days), optional `vanId` filter, `pageNumber`, `pageSize`, `signature`. Returns `orderList[]`:

| Field | Notes |
|---|---|
| `orderId` | Paytm-generated, unique per inbound payment |
| `vanId` | 16-char |
| `amount` | string of rupees, e.g. `"50000"` |
| `transactionId` | Paytm txn ID |
| `remitterName` | as sent by remitter bank |
| `remitterAccount` | may be empty (see quirk #5) |
| `remitterIFSC` | may be empty |
| `transactionMode` | `NEFT` \| `RTGS` \| `IMPS` \| `UPI` |
| `transactionDate` | ISO 8601 |
| `status` | `SUCCESS` \| `FAILED` |
| `remarks` | free-text from remitter |

Use this for nightly reconciliation. Iterate pages until `pageNumber * pageSize >= totalCount`.

### 6. Transaction Status

```
POST {BASE}/van/transactionStatus
```

Request: `mid`, `orderId` (or `transactionId`), `signature`. Returns the same fields as Order List plus `refundStatus` (`NOT_INITIATED` \| `INITIATED` \| `SUCCESS` \| `FAILED`) and the original `udf` map.

### 7. Refund

```
POST {BASE}/van/refund
```

Request:

| Field | Type | Required | Notes |
|---|---|---|---|
| `mid` | string | ✅ | |
| `refundId` | string | ✅ | Your idempotency key; must be unique across all refunds for this MID |
| `orderId` | string | ✅ | Original inbound payment |
| `refundAmount` | string | ✅ | Rupees; ≤ ₹2L per call |
| `refundReason` | string | optional | Free-text or `PARTIAL_REFUND` / `FULL_REFUND` |
| `signature` | string | ✅ | |

Response `refundStatus`: `INITIATED` (terminal happy path; final state via webhook or `/van/refundStatus`).

**Splitting large refunds:** for ₹5L, send three calls with `refundId` like `REF_ORD123_1`, `REF_ORD123_2`, `REF_ORD123_3` and amounts `200000`, `200000`, `100000`. Track all three in your DB and only mark the order fully refunded when all three reach `SUCCESS`.

### 8. Refund Status

```
POST {BASE}/van/refundStatus
```

Request: `mid`, `refundId`, `signature`. Returns `refundStatus`, `refundAmount`, `processedDate`.

---

## Checkout flow — Order-based VAN via Initiate Transaction

For the Checkout flow, integrate with the standard `/initiateTransaction` endpoint and add a `vanInfo` block:

```json
{
  "mid": "YOUR_MID",
  "orderId": "ORD_20260120_001",
  "txnAmount": { "value": "100000.00", "currency": "INR" },
  "vanInfo": {
    "merchantPrefix": "PYTM",
    "identificationNo": "9432568398",
    "orderTimeout": 3600,
    "customization": "MERCHANT_MANAGED"
  },
  "signature": "<sig>"
}
```

Response includes:

```json
{
  "vanDetails": {
    "vanId": "PPSLPYTM9432568398",
    "ifsc": "UTIB0CCH274",
    "beneficiaryName": "Paytm Payments Services Ltd.",
    "orderAmount": "100000",
    "orderTimeout": 3600,
    "expiryTime": "2026-01-20T11:30:00Z"
  }
}
```

Render `vanId`, `ifsc`, `beneficiaryName`, `orderAmount`, and a countdown to `expiryTime` on your payment page. **Use the allowed Terminology rules from the bundle preamble — describe this as "Bank Transfer (NEFT / RTGS / IMPS)", not "Wallet" or any other instrument.**

**Checksum generation (different from VAN webhook HMAC : do not confuse the two):**

```js
const PaytmChecksum = require('paytmchecksum');
const signature = await PaytmChecksum.generateSignature(
  JSON.stringify(bodyObj),
  process.env.PAYTM_MERCHANT_KEY
);
const paytmPayload = { body: bodyObj, head: { signature } };
```

Always include `callbackUrl` in the request body: `"callbackUrl": "https://yoursite.com/api/callback"`

---

**Frontend null-safety : mandatory:**

```js
if (!vanDetails || !vanDetails.vanId) {
  console.error('[LPC] vanDetails absent : LPC not activated on MID:', mid);
  openPaytmModal(txnToken); // fallback
  return;
}
```

**Browser callback : handle the page reload:**

```js
// Server
app.post('/api/callback', (req, res) => {
  const { ORDERID, STATUS } = req.body;
  res.redirect(`/?orderId=${ORDERID}&cbStatus=${STATUS}`);
});

// Frontend : save before API call
sessionStorage.setItem('paytm_cart', JSON.stringify(cart));
sessionStorage.setItem('paytm_id_no', identificationNo);

// Frontend : restore on DOMContentLoaded after reload
const saved = sessionStorage.getItem('paytm_cart');
if (saved) cart = JSON.parse(saved);
```

`STATUS` on callback: `TXN_SUCCESS` | `PENDING` (normal for bank transfers) | `TXN_FAILURE`. Always reconcile via webhook : never rely on browser callback alone.

---

## Webhook payloads (full)

### `PAYMENT_SUCCESS`

```json
{
  "eventType": "PAYMENT_SUCCESS",
  "orderId": "ORDER_001",
  "transactionId": "TXN_001",
  "vanId": "PPSLPYTM9876533333",
  "mid": "YOUR_MID",
  "amount": "50000",
  "transactionMode": "NEFT",
  "remitterName": "Acme Distributors Pvt Ltd",
  "remitterAccount": "1234567890123",
  "remitterIFSC": "HDFC0000001",
  "transactionDate": "2024-01-20T12:30:00Z",
  "status": "SUCCESS",
  "udf": { "region": "north", "salesRep": "rk@acme" },
  "entityName": "Acme Distributors Pvt Ltd",
  "entityType": "BUSINESS",
  "customerId": "CUST_001",
  "signature": "<sig>"
}
```

### `PAYMENT_FAILURE` (TPV reject)

```json
{
  "eventType": "PAYMENT_FAILURE",
  "orderId": "ORDER_001",
  "vanId": "PPSLPYTM9876533333",
  "mid": "YOUR_MID",
  "amount": "50000",
  "transactionMode": "NEFT",
  "remitterName": "Unknown Payer",
  "remitterAccount": "9999999999999",
  "remitterIFSC": "AXIS0000001",
  "failureReason": "TPV_VALIDATION_FAILED",
  "failureDescription": "Payment from unregistered bank account",
  "status": "FAILED",
  "signature": "<sig>"
}
```

Common `failureReason` values: `TPV_VALIDATION_FAILED`, `AMOUNT_MISMATCH` (Checkout flow), `ORDER_EXPIRED` (Checkout flow), `VAN_DISABLED`.

### `REFUND_SUCCESS` / `REFUND_FAILURE`

```json
{
  "eventType": "REFUND_SUCCESS",
  "refundId": "REFUND_001",
  "orderId": "ORDER_001",
  "mid": "YOUR_MID",
  "refundAmount": "25000",
  "refundStatus": "SUCCESS",
  "processedDate": "2024-01-21T16:30:00Z",
  "signature": "<sig>"
}
```

### Webhook handler checklist

- [ ] Verify `signature` over the body (with `signature` field stripped) before any DB write
- [ ] Dedup on `(mid, orderId, eventType)` — Paytm retries on non-2xx
- [ ] ACK HTTP 200 within 5s; process async
- [ ] Treat `amount` as string-of-rupees; parse to your currency type explicitly
- [ ] Log raw payload to cold storage for 7+ years (RBI / SEBI reconciliation)

### Non-Checkout flow — frontend polling

The Non-Checkout flow has no redirect or push to the browser. After displaying the VAN to the payer, store incoming webhook payments server-side keyed by `vanId` and expose a polling endpoint (e.g. `GET /api/van-payment-status?vanId=...`). Poll every ~5s from the frontend until `status: SUCCESS` or session timeout. The webhook remains the canonical source of truth; the polling endpoint just reflects what the webhook recorded.

### Non-Checkout flow — frontend form pattern

- **Use `type="button"` with a direct `onclick` handler — never `type="submit"` inside a `<form>` with required fields.** Browser-native form validation silently blocks the submit before JavaScript runs when any required field is empty, making the button appear dead with no error shown.
- **Show inline status directly below the Create VAN button** — not in a separate status panel elsewhere on the page. If the error is far from where the user clicked, it is invisible.
- **Add a loading state.** Disable the button and change its label to something like "Creating VAN…" while the API call is in flight. Without this, a slow API call looks identical to a dead button.
- **Only `identificationNo` should be required from the user.** Name, mobile, and email are needed for the Paytm payload but should be optional in the UI with backend-supplied defaults — don't block VAN creation with browser validation on fields the user doesn't strictly need to enter.

---

## Reconciliation pattern

**Real-time:** webhook → write inbound payment row keyed on `(vanId, orderId)`.

**Hourly job:** `/van/orderList` for the last 2 hours → backfill any webhook misses.

**Nightly job:** `/van/orderList` for previous day → cross-check against your DB → alert on mismatches.

**T+2 settle recon:** download settlement report from dashboard → reconcile total credited to your bank account against sum of `SUCCESS` payments minus refunds for that settlement date.

The `udf` map is your friend — populate it with whatever internal IDs (customer ID, invoice ID, billing cycle, sales rep) you need to join against, since the remitter bank message has no field for them.

---

## TPV (Third-Party Validation) — deep dive

**What it is:** Paytm validates the payer's bank account against a whitelist you maintain per VAN. Non-whitelisted payments are bounced at source (before settlement) and surface as `PAYMENT_FAILURE` webhooks with `failureReason: TPV_VALIDATION_FAILED`.

**Why it matters:** Mandatory for BFSI (SEBI-regulated entities — mutual funds, brokers, AIFs, PMS) under the "Pay from First Holder's Account" rule. Optional but useful for any merchant that wants to prevent third-party payments (e.g. anti-money-laundering, KYC integrity).

**Rules:**
- Max **10** active bank accounts per VAN.
- Add via `/van/create` (in `thirdPartyValidation[]`) or `/van/update` (via `addThirdPartyValidation[]`).
- Remove via `/van/update` with `removeThirdPartyValidation[]`. Removal is immediate.
- All listed accounts must be in `Active` status at the partner bank — Paytm does not pre-validate at registration time; mismatch fails at payment time.

---

## Error codes (full table)

| Code | Meaning | When | Action |
|---|---|---|---|
| `01000100` | Success | All happy paths | — |
| `01000001` | Invalid request format | Missing required field, bad enum value, malformed JSON | Re-check field table for the endpoint |
| `01000002` | Signature mismatch (auth failed) | Wrong merchant key, canonical JSON differs from signed bytes, key rotated | Recompute signature; check that you're using the right env's key |
| `01000003` | VAN not found | `vanId` typo, wrong MID context, VAN belongs to another MID | Confirm `vanId` from a fresh `/van/list` |
| `01000004` | Merchant not activated | Large Payment Collection not enabled for this MID | Raise activation ticket |
| `01000005` | Amount out of range | NEFT/IMPS > ₹2L without falling back to RTGS, or below ₹1 | Switch rail or fix amount |
| `01000006` | Order timeout expired (Checkout flow) | Payment arrived after `expiryTime` | Recreate the order with a new VAN; original payment is auto-refunded |
| `01000007` | TPV validation failed | Payer bank account not in whitelist | Add to TPV list via `/van/update` (if legitimate) or treat as suspicious |
| `01000008` | Duplicate request | Replayed `requestId` (Create) or `refundId` (Refund) | Idempotent — original response was returned; no action |
| `01000009` | Remitter info missing | Inbound bank message had no remitter account/IFSC | Refund out-of-band; surface in dashboard |
| `2001` | Bank Transfer mode not enabled on MID | LPC is activated but the Bank Transfer (NEFT/RTGS/IMPS) sub-switch is off — these are two distinct switches | Contact Paytm integration team; no code fix |
| `2002` | CheckSum Validation Failure | `head.token` missing / misnamed as `signature`, or any of `clientId` / `version` / `requestTimestamp` / `channelId` / `tokenType` absent from `head` | Fix the head envelope per the vanproxy head field table |
| `4010` | Already exists | `(merchantPrefix, identificationNo)` already mapped to a VAN (Non-Checkout flow only — permanent) | Query the existing VAN; use a different `identificationNo` for a new customer |

---

## Sample sequence — fee collection (Non-Checkout flow)

1. **Customer onboarding:** create one VAN per student, store `vanId` against student ID.
2. **Fee notice:** email the student with `vanId`, IFSC `UTIB0CCH274`, beneficiary `Paytm Payments Services Ltd.`, and amount due.
3. **Parent pays via their bank's NEFT/RTGS/IMPS portal** to that VAN.
4. **Webhook fires** within seconds (IMPS) to ~2 hrs (NEFT batch) → mark fee paid in your DB; email receipt.
5. **Nightly recon:** `/van/orderList` for the day → cross-check; flag any unmatched payments for manual review.
6. **T+1 settlement** of all the day's collections to your school bank account.

---

## Sample sequence — auction win (Checkout flow)

1. **Customer wins auction at ₹3,50,000.**
2. **Server calls `/initiateTransaction`** with `txnAmount: "350000.00"` + `vanInfo` block (`orderTimeout: 7200` for 2-hour window).
3. **Show payer:** `vanId`, IFSC, beneficiary, exact amount, 2-hour countdown. Emphasise: pay **exactly** this amount; partial / over / late = auto-refund.
4. **Payer initiates RTGS** (mandatory rail above ₹2L) from their bank.
5. **Webhook `PAYMENT_SUCCESS`** → release auction lot.
6. **If `PAYMENT_FAILURE` (`AMOUNT_MISMATCH` or `ORDER_EXPIRED`):** notify payer, original transfer is auto-refunded; offer fresh order.

---

## Cross-skill notes

- **vs `paytm-js-checkout`:** different endpoint family (`/van/*` vs `/theia/api/v1/*`), different signature surface, different reconciliation endpoint. Don't share helper code blindly.
- **vs `paytm-payment-links`:** Payment Links also use server-pull reconciliation (`/link/fetchTransaction`); Large Payment Collection prefers push (webhooks) supplemented by `/van/orderList`. Don't poll `/van/transactionStatus` for every order — it doesn't scale.
- **vs `paytm-refunds`:** the `/refund/apply` endpoint from the standard refunds skill does **not** apply here. Large Payment Collection has its own `/van/refund` with different idempotency rules and the ₹2L per-call cap.
- **vs `paytm-webhooks`:** the generic webhook skill's signature-verification helper works as-is, but the **event types are different** (`PAYMENT_SUCCESS` / `PAYMENT_FAILURE` / `REFUND_SUCCESS` / `REFUND_FAILURE` instead of the JS-Checkout event names).
