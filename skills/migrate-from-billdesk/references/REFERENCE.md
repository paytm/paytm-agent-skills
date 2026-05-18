# BillDesk → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping for BOTH BillDesk integration variants (legacy pipe-delimited PaymentRequest AND v1.2 JWS+JWE), eMandate mapping, refund flow, dual-write rollout, cutover.

---

## BillDesk integration variants

| Variant | Identifier hint | Active since |
|---|---|---|
| **Legacy PaymentRequest** (still very common) | Pipe-delimited `msg` field, HTTP forms POSTed to `/pgidsk/PGIMerchantPayment`, HMAC-SHA256 hash appended to message string | Original PG; still in use across most older integrations |
| **Online Payment v1.2 (JWS + JWE)** | `POST /payments/ve1_2/orders/create`, HTTP headers `BdSignature` / `BdTimestamp` / `BdJwe`, JWS-signed body, JWE-encrypted payload | Post-2021 standard for new integrations |

Identify the variant FIRST before generating any code. The two coexist (a merchant can have both, with v1.2 for new product lines and legacy for old). Migration to Paytm collapses both into a single Paytm REST + checksum shape.

---

## Concepts mapping

| BillDesk term (legacy) | BillDesk term (v1.2) | Paytm | Notes |
|---|---|---|---|
| `MerchantID` | `MerchantID` | `MID` | Identifier |
| `SecurityID` | `ClientID` | (no equivalent — Paytm has no separate client id) | Legacy uses SecurityID inside the message; v1.2 sends ClientID in header |
| `ChecksumKey` (32+ chars) | `SecretKey` (HS256 key) | `MERCHANT_KEY` | Signing secret |
| `TxnReferenceNo` (merchant) | `orderid` (merchant) | `orderId` (merchant) | Both PSPs expect you to generate |
| `BankReferenceNo` (BillDesk) | `transactionid` (BillDesk) | `TXNID` (Paytm) | Per-payment PSP-issued id |
| `CustomerID` | `customer_id` | `userInfo.custId` | Sanitize charset for Paytm: `[A-Za-z0-9_@-]` |
| `ReturnURL` | `return_url` (in JWE payload) | `callbackUrl` | Where to send the customer back |
| `AdditionalInfo1`...`AdditionalInfo7` | `additional_info` object | (no UDF concept) | Move to your own DB |
| (none) | `BdSignature` HTTP header | `head.signature` field in body | v1.2 signature lives in header, Paytm in body |

---

## Auth model — every API call

### BillDesk Legacy

```js
// 1. Build the message as pipe-delimited string in a fixed positional schema
const msg = [
  MERCHANT_ID, customerId, "NA", amount.toFixed(2), "NA", "NA", "NA",
  "INR", "NA", "R", SECURITY_ID, "NA", "NA", "F", "NA", "NA", "NA",
  "NA", "NA", returnUrl
].join("|");

// 2. HMAC-SHA256 the message with ChecksumKey, uppercase hex
import crypto from "node:crypto";
const checksum = crypto
  .createHmac("sha256", CHECKSUM_KEY)
  .update(msg)
  .digest("hex")
  .toUpperCase();

// 3. Append the checksum with another pipe; this is the final form field value
const finalMsg = msg + "|" + checksum;

// 4. Render hidden form POSTing to https://pgi.billdesk.com/pgidsk/PGIMerchantPayment
//    Form field: msg=<finalMsg>
```

### BillDesk v1.2 (JWS + JWE)

```js
// 1. Build the order JSON
const body = {
  mercid: MERCHANT_ID,
  orderid: orderId,
  amount: amount.toFixed(2),
  currency: "356",  // INR ISO code
  ru: returnUrl,
  // ... other fields
};

// 2. JWS-sign with SecretKey (HS256)
import { SignJWT, EncryptJWT } from "jose";
const secret = new TextEncoder().encode(BILLDESK_SECRET_KEY);
const jws = await new SignJWT(body)
  .setProtectedHeader({ alg: "HS256", clientid: BILLDESK_CLIENT_ID })
  .sign(secret);

// 3. (Some endpoints) JWE-encrypt the JWS as the request body
//    alg: "dir", enc: "A128CBC-HS256"
//    OR send the JWS as the raw HTTP body with headers

// 4. POST /payments/ve1_2/orders/create
await fetch("https://pgi.billdesk.com/payments/ve1_2/orders/create", {
  method: "POST",
  headers: {
    "Content-Type": "application/jose",
    "BdSignature": "<sig>",
    "BdTimestamp": Date.now().toString(),
    "Accept": "application/jose"
  },
  body: jws,  // or the JWE
});
```

### Paytm

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

Three patterns, none interchangeable. Delete the BillDesk helper (pipe-builder for legacy, JOSE/jose library for v1.2) during cutover.

---

## One-time payment — full per-step diff

### Step 1: server creates order

| | BillDesk Legacy | BillDesk v1.2 | Paytm |
|---|---|---|---|
| Endpoint | (no API — render form, browser submits to `/pgidsk/PGIMerchantPayment`) | `POST https://pgi.billdesk.com/payments/ve1_2/orders/create` | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=...&orderId=...` |
| Auth | Append HMAC-SHA256 to msg | `BdSignature` header + JWS body | `head.signature` over JSON body |
| Amount | Pipe-field, decimal string `"100.00"` | JSON field `amount: "100.00"` | `txnAmount.value: "100.00"` |
| Order id | `TxnReferenceNo` (your value) | `orderid` (your value) | `orderId` (your value) |
| Returns | (no return — browser redirects) | JWS/JWE-encoded JSON | `{ body: { txnToken } }` |

### Step 2: frontend payment UI

| | BillDesk Legacy | BillDesk v1.2 | Paytm |
|---|---|---|---|
| What user sees | Full-page redirect to BillDesk hosted page | Same hosted page (or merchant-integrated) | In-page modal (or `redirect: true`) |
| Frontend work | Render hidden form, JS submit | Render link/redirect using returned URL | Load merchant `.js`, call `Paytm.CheckoutJS.init({...}).then(invoke)` |
| Customer return | BillDesk POSTs msg back to `ReturnURL` | BillDesk POSTs JWE/JWS back | Paytm POSTs callback (form-encoded) |

See `js-checkout` skill for the Paytm-side pattern.

### Step 3: source-of-truth check

| | BillDesk Legacy | BillDesk v1.2 | Paytm |
|---|---|---|---|
| Endpoint | `POST /pgidsk/PGIQueryController` (pipe-delimited query message) | `POST /payments/ve1_2/orders/{order_id}` (JWS-signed) | `POST {PAYTM_PG_DOMAIN}/v3/order/status` (head `signature` only) |
| Status field | Position 14 in the pipe-delimited response: `0300` (success), `0399` (failure), `NA` (initiated) | `transaction_status` field in JSON | `body.resultInfo.resultStatus` |

Map BillDesk → Paytm status enum during dual-write reconciliation:

| BillDesk legacy `AuthStatus` | BillDesk v1.2 `transaction_status` | Paytm `resultStatus` |
|---|---|---|
| `0300` | `Success` | `TXN_SUCCESS` |
| `0399` | `Failure` | `TXN_FAILURE` |
| `0002` / `NA` / `Initiated` | `Pending` / `Initiated` | `PENDING` |
| `Aborted` | `Aborted` | `TXN_FAILURE` |

---

## eMandate / SI recurring mapping

BillDesk has a strong NPCI-rails eMandate product widely used by utility merchants, education, mutual funds. Migration to Paytm's NATIVE_SUBSCRIPTION is feasible but the mandate authentication moves from bank-redirect (BillDesk pattern) to UPI Autopay / eMandate (Paytm pattern).

### Field mapping

| BillDesk eMandate field | Paytm subscription field | Notes |
|---|---|---|
| `mercid` | `mid` | Identifier |
| `customerid` | `userInfo.custId` | |
| `mndt_amount` | `txnAmount.value` | Charge amount per cycle (or max for VARIABLE) |
| `mndt_start_date` | `subscriptionStartDate` (YYYY-MM-DD, IST) | Paytm rejects past dates |
| `mndt_end_date` | `subscriptionExpiryDate` | |
| `mndt_frequency` (e.g. MONTHLY) | `subscriptionFrequency` + `subscriptionFrequencyUnit` (e.g. `1`, `MONTH`) | See frequency mapping below |
| `mndt_amount_type` (FIXED / MAX) | `subscriptionAmountType` (`FIX` / `VARIABLE`) | FIXED → FIX, MAX → VARIABLE |
| `debit_day` | (derived from `subscriptionStartDate`) | Paytm debits on cycle anniversary |

### Frequency mapping

| BillDesk | Paytm `subscriptionFrequency` + `subscriptionFrequencyUnit` |
|---|---|
| `DAILY` | `1`, `DAY` |
| `WEEKLY` | `7`, `DAY` (or `1`, `WEEK` if MID supports) |
| `MONTHLY` | `1`, `MONTH` |
| `QUARTERLY` | `3`, `MONTH` |
| `HALFYEARLY` | `6`, `MONTH` |
| `YEARLY` | `1`, `YEAR` |
| `ASPRESENTED` (variable) | Use `subscriptionAmountType: "VARIABLE"` with frequency matching the typical cycle |

`subscriptionGraceDays` must be < cycle length on Paytm — BillDesk has no such constraint. See `subscriptions` skill rule #17.

### Mandate handover

Do **NOT** cancel active BillDesk eMandates on cutover. NPCI mandates are bound to the bank — customers cancelling them mid-cycle creates a CX problem.

- Existing BillDesk mandates: continue debiting on BillDesk until natural expiry OR until the customer re-authorises on Paytm.
- New mandates: only on Paytm.
- Track per-mandate gateway in DB:
  ```sql
  ALTER TABLE subscriptions ADD COLUMN psp TEXT NOT NULL DEFAULT 'billdesk';
  ```

After all BillDesk mandates have expired (which for some products can take years — e.g. SIPs), rotate BillDesk credentials.

---

## Refunds

| | BillDesk Legacy | BillDesk v1.2 | Paytm |
|---|---|---|---|
| Endpoint | `POST /pgidsk/PGIQueryController` with refund command | `POST /payments/ve1_2/refunds` (JWS) | `POST /refund/apply` |
| Body | Pipe-delimited: `RefundTxn\|MerchantID\|TxnReferenceNo\|Amount\|Reason\|Checksum` | JWS-signed JSON | JSON `{ body: { txnType: "REFUND", orderId, txnId, refId, refundAmount } }` |
| Identifier returned | `RefundReferenceNo` (BillDesk-issued) | `refundid` (BillDesk-issued) | `refundId` (Paytm-issued) |
| Idempotency | Reuse `TxnReferenceNo` + `RefundReferenceNo` | Reuse merchant-side refund id | Reuse same `refId` |
| Status | `POST /pgidsk/PGIQueryController` with refund status command | `POST /payments/ve1_2/refunds/{id}` | `POST /v2/refund/status` |

---

## Webhooks - signature scheme

### BillDesk Legacy

```
HTTP POST /your/s2s/url
Headers:  Content-Type: application/x-www-form-urlencoded
Body:     msg=MerchantID|CustomerID|...|<Checksum>
```

Verification = split by `|`, last field is checksum, re-HMAC-SHA256 the rest with ChecksumKey, compare uppercase hex.

### BillDesk v1.2

```
HTTP POST /your/s2s/url
Headers:  Content-Type: application/jose
          BdSignature: <header signature>
Body:     <JWS or JWE>
```

Verification = JWS verify with SecretKey (and optional JWE decrypt first).

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

---

## Dual-write rollout — BillDesk specific tweaks

Use the Razorpay dual-write architecture (`migrate-from-razorpay/references/REFERENCE.md` § Dual-write) with these tweaks:

1. **Canary decision is final per attempt.** Both BillDesk variants are full-page redirect — once the customer is at `pgi.billdesk.com` you cannot switch to Paytm mid-flow. Plan canary metrics around full-flow per-customer pinning.
2. **Two reconcilers per BillDesk variant.** If the merchant runs both legacy + v1.2, your reconciliation job needs THREE branches (legacy parse, v1.2 JWS verify, Paytm JSON). Map all three to a common status enum.
3. **Bank settlement timing differs.** BillDesk often settles T+1 (or longer for SIPs); Paytm settles T+1 by default. Confirm the merchant's BillDesk settlement cycle before quoting parity to finance.

---

## Cutover checklist

When canary at 100% is stable for ≥ 4 weeks (BillDesk merchants are typically more conservative; the longer canary catches edge cases):

- [ ] All new orders going to Paytm.
- [ ] BillDesk credentials still configured but ONLY for refunds + dispute responses + active mandate debits on legacy transactions.
- [ ] Active eMandates on BillDesk continue running until natural expiry OR customer re-authorises on Paytm.
- [ ] Refund script knows the gateway per historical order (`psp_used: "billdesk-legacy" | "billdesk-v1.2" | "paytm"`).
- [ ] Customer support trained on Paytm dashboard.
- [ ] Settlement reconciliation team aware of new schedule.
- [ ] **JOSE / pipe-parsing helpers deleted** from the codebase (the grep in `SKILL.md` § cleanup catches them).
- [ ] **`access_code` / `BdSignature` env vars removed** — Paytm has no equivalent.
- [ ] BillDesk credentials kept live for **180 days minimum** for utility / SIP merchants (longer than the other migrations because of long-duration mandate cycles).
- [ ] After 180 days of clean Paytm operation, rotate BillDesk keys + cancel contract.

---

## Common pitfalls when porting

| Bug seen | Cause | Fix |
|---|---|---|
| Checksum / signature failures everywhere on Paytm | Developer kept the BillDesk helper and tried to sign Paytm bodies with HMAC-SHA256 of a pipe-joined version | Delete pipe-builder; Paytm uses `paytmchecksum` on JSON |
| 401 on every Paytm API call | Sent `BdSignature` / `BdTimestamp` headers to Paytm | Drop the headers; Paytm uses body checksum |
| Amount off | Position-mismatched the pipe-delimited message (Legacy) — wrong field at wrong index | If you're not migrating off legacy yet, sanity-check positions against BillDesk's spec; for Paytm, just use `txnAmount.value` |
| eMandates double-debiting | Cancelled BillDesk mandates on cutover, new mandates on Paytm, but legacy mandates also continued | Don't cancel BillDesk mandates; let them expire naturally |
| Webhook signature fails | Tried to AES-decrypt or JWE-decrypt Paytm webhook (BillDesk muscle memory) | Paytm webhooks are plain JSON; use `PaytmChecksum.verifySignature` on the body |
| Settlement amounts off | BillDesk settles certain payment modes differently (utility flows have different cycles) | Reconcile gross + fees per payment mode separately for the cutover quarter |

---

## Other source gateways

- `migrate-from-razorpay` (shipped)
- `migrate-from-payu` (shipped)
- `migrate-from-cashfree` (shipped)
- `migrate-from-juspay` (shipped)
- `migrate-from-ccavenue` (shipped)
