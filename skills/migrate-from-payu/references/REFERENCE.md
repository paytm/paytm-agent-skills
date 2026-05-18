# PayU → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping, hash scheme deep dive, recurring-payments translation, dual-write rollout, reconciliation, cutover checklist.

---

## PayU product flavors

PayU India has three product flavors that look similar from the outside but differ in payload shape. Check which one the user has before generating mapping code:

| Flavor | Identifier hint | Endpoint base | Notes |
|---|---|---|---|
| **PayU Biz / Enterprise (custom checkout)** | Code has `key` + `salt`, posts to `/_payment` | `https://secure.payu.in` / `https://test.payu.in` | Most full-API integrations. Hash-based. |
| **PayU Money (hosted)** | Code POSTs to `payumoney.com` URLs | `https://secure.payumoney.com` | Simpler hosted checkout, slightly different field set. |
| **PayU India Bolt (overlay)** | Code uses `bolt.payu.in/bolt.min.js` | Same base, JS overlay | Browser overlay over form-POST. |

Most migration questions are about Biz/Enterprise. PayU Money and Bolt use the same underlying hash + form fields but with different surface ergonomics.

---

## Auth model — request

### PayU

Form-POST. The hash is just another form field. No HTTP Basic, no headers, no SDK auth call.

```html
<form action="https://secure.payu.in/_payment" method="POST">
  <input type="hidden" name="key"         value="..." />
  <input type="hidden" name="txnid"       value="ORD_001" />
  <input type="hidden" name="amount"      value="100.00" />
  <input type="hidden" name="productinfo" value="Product Description" />
  <input type="hidden" name="firstname"   value="Buyer" />
  <input type="hidden" name="email"       value="buyer@example.com" />
  <input type="hidden" name="phone"       value="9999999999" />
  <input type="hidden" name="surl"        value="https://yoursite.com/payu/success" />
  <input type="hidden" name="furl"        value="https://yoursite.com/payu/failure" />
  <input type="hidden" name="hash"        value="<sha512 of pipe-joined fields + salt>" />
  <button type="submit">Pay</button>
</form>
```

### Paytm

JSON REST. The signature lives inside the body envelope. No form POST anywhere.

```js
import PaytmChecksum from "paytmchecksum";

const body = {
  requestType: "Payment",
  mid: MID,
  websiteName: WEBSITE_NAME,
  orderId: "ORD_001",
  callbackUrl,
  txnAmount: { value: "100.00", currency: "INR" },
  userInfo: { custId: "CUST_001", mobile: "9999999999", email: "buyer@example.com" },
};
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);

await fetch(`https://securestage.paytmpayments.com/theia/api/v1/initiateTransaction?mid=${MID}&orderId=ORD_001`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ head: { signature }, body }),
});
```

The two patterns are not interchangeable. Don't try to keep a "shared hash helper" — delete the PayU code entirely and use `paytmchecksum`.

---

## Hash scheme deep dive

PayU's hash is positionally sensitive and the empty-UDF padding trips up most ports. The exact formulas:

### Forward hash (request)

```
sha512(
  key + "|" +
  txnid + "|" +
  amount + "|" +
  productinfo + "|" +
  firstname + "|" +
  email + "|" +
  udf1 + "|" + udf2 + "|" + udf3 + "|" + udf4 + "|" + udf5 + "|" +
  "" + "|" + "" + "|" + "" + "|" + "" + "|" + "" + "|" +    // udf6-udf10 ALWAYS empty
  salt
)
```

- All UDFs (`udf1`-`udf5`) join with `|` even if empty.
- `udf6`-`udf10` are always padded as empty (5 pipes).
- `salt` is appended last with a `|` separator.
- Empty fields become `""`, not omitted — the `|` count stays the same.

### Reverse hash (response from PayU)

PayU POSTs the result to your `surl` or `furl`. Verification uses the SAME fields in **reverse order**, with `status` prepended:

```
sha512(
  salt + "|" +
  status + "|" +
  "" + "|" + "" + "|" + "" + "|" + "" + "|" + "" + "|" +    // empty additional response cols
  udf5 + "|" + udf4 + "|" + udf3 + "|" + udf2 + "|" + udf1 + "|" +
  email + "|" + firstname + "|" + productinfo + "|" + amount + "|" + txnid + "|" + key
)
```

### Paytm equivalent (much simpler)

```js
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);
const isValid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, signature);
```

The library handles serialization, padding, and verification. Delete every PayU hash function in the codebase during cutover — they are not adaptable.

---

## One-time payment - full per-step diff

### Step 1: server prepares request

| | PayU | Paytm |
|---|---|---|
| What you build | An HTML form with hidden fields | A JSON body envelope |
| Where the auth lives | `hash` form field | `head.signature` inside the JSON |
| Amount format | Decimal string `"100.00"` (rupees) | Decimal string `"100.00"` (rupees) — same |
| Order id | `txnid` (your id) | `orderId` (your id, charset `[A-Za-z0-9_@-]`, ≤50 chars) |
| Customer fields | `firstname`, `email`, `phone` flat | `userInfo` envelope: `firstName`, `email`, `mobile`, `custId` |
| What gets sent | Browser POSTs the form to PayU | Server POSTs JSON; returns `txnToken` to your frontend |

```js
// PayU server: just render the form
res.render("checkout", {
  key: PAYU_KEY,
  txnid: orderId,
  amount: amount.toFixed(2),
  productinfo: "Order " + orderId,
  firstname: customer.name,
  email: customer.email,
  phone: customer.phone,
  surl, furl,
  hash: forwardHash({ key, txnid: orderId, amount, productinfo: ..., firstname: ..., email: ..., salt: PAYU_SALT }),
});
```

```js
// Paytm server: call API, return token to frontend
const body = { /* ... see auth model section */ };
const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY);
const r = await fetch(`${PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`, { /* ... */ });
const { body: { txnToken } } = await r.json();
res.json({ txnToken, orderId, amount: amount.toFixed(2) });
```

### Step 2: frontend payment UI

| | PayU | Paytm |
|---|---|---|
| What user sees | Full-page redirect to PayU's hosted checkout | In-page JS Checkout modal (or full-page redirect when modal blocked) |
| Frontend work | Render the form, hit Submit | Load merchant `.js`, call `Paytm.CheckoutJS.init(...).then(invoke)` |
| Loader script | `https://bolt.payu.in/bolt.min.js` (if using Bolt overlay) | `{PAYTM_PG_DOMAIN}/merchantpgpui/checkoutjs/merchants/{MID}.js` |
| Customer return | PayU POSTs to `surl` (success) or `furl` (failure) | Paytm POSTs to single `callbackUrl`; read `STATUS` to branch |

See the `js-checkout` skill for the Paytm-side pattern (static loader recommended, `merchant: { redirect: true }` for popup-blocker safety).

### Step 3: server-side verification

| | PayU | Paytm |
|---|---|---|
| Where verification happens | In your `surl`/`furl` handler | In your `callbackUrl` handler |
| Verification primitive | Reverse SHA-512 over form fields + salt | `PaytmChecksum.verifySignature(rawBody, KEY, sig)` |
| What confirms truth | `command=verify_payment` API call to PayU | `POST /v3/order/status` server-to-server |

### Step 4: source-of-truth check

| | PayU | Paytm |
|---|---|---|
| Endpoint | `POST https://info.payu.in/merchant/postservice?form=2` | `POST {PAYTM_PG_DOMAIN}/v3/order/status` |
| Body | Form-encoded: `key=...&command=verify_payment&var1=<txnid>&hash=...` | JSON: `{ head: { signature }, body: { mid, orderId } }` |
| Status field | `status: "success" / "failure" / "pending"` | `body.resultInfo.resultStatus: "TXN_SUCCESS" / "TXN_FAILURE" / "PENDING"` |
| Hash on this call | Forward hash with command + var1: `sha512(key|command|var1|salt)` | `head.signature` ONLY (no `tokenType`, no `timestamp`) |

**Common porting bug:** developers copy PayU's hash construction (`key|command|var1|salt`) into the Paytm Transaction Status call. Paytm doesn't use that scheme — use `PaytmChecksum.generateSignature` over the JSON body.

---

## Recurring payments / SI mapping

PayU implements recurring as "Standing Instruction" (SI) — a flag in the initial payment plus a separate `command=create_invoice_recurring_payments` call. Paytm uses NATIVE_SUBSCRIPTION as a first-class flow.

### PayU initial transaction with SI

```
POST /_payment
key=...
txnid=SUB_001
amount=2.00
productinfo=Monthly Plan
firstname=...
email=...
si=1                                ← SI flag
store_card_token=1
si_details={
  "billingAmount":"499.00",
  "billingCurrency":"INR",
  "billingCycle":"month",
  "billingInterval":1,
  "paymentStartDate":"2026-06-01",
  "paymentEndDate":"2027-06-01"
}
hash=...
```

### Paytm equivalent

```
POST {PAYTM_PG_DOMAIN}/subscription/create?mid=...&orderId=SUB_001&traceId=tr_001
head: { clientId, channelId, signature }
body: {
  requestType: "NATIVE_SUBSCRIPTION",
  mid, websiteName, orderId, callbackUrl,
  txnAmount: { value: "2.00", currency: "INR" },     // mandate authorization amount
  userInfo: { custId },
  subscriptionAmountType: "FIX",
  subscriptionFrequency: "1",
  subscriptionFrequencyUnit: "MONTH",
  subscriptionStartDate: "2026-06-01",
  subscriptionExpiryDate: "2027-06-01",
  subscriptionPaymentMode: "UNKNOWN",
  subscriptionGraceDays: "3"
}
```

Frequency mapping:

| PayU `billingCycle` + `billingInterval` | Paytm `subscriptionFrequency` + `subscriptionFrequencyUnit` |
|---|---|
| `"day"`, `1` | `1`, `DAY` |
| `"week"`, `1` | `7`, `DAY` (or `1`, `WEEK` if MID supports it) |
| `"month"`, `1` | `1`, `MONTH` |
| `"year"`, `1` | `1`, `YEAR` |

**Note** — `subscriptionGraceDays` must be < cycle length on Paytm (else `4001` error). PayU doesn't have this constraint. See `subscriptions` skill.

### Charge cycle events

```
PayU webhook                                Paytm webhook
────────────                                ─────────────
status=success, addedon=...                 body.txnType="SUBSCRIPTION_DEBIT"
unmappedstatus=captured                     body.status="TXN_SUCCESS"
mihpayid=...                                body.txnId=...
si=1                                        body.orderId=...
```

### Cancel

```
PayU:    POST /merchant/postservice?form=2
         command=cancel_si&var1=<txnid>&hash=...
Paytm:   POST /subscription/cancel
         { head:{signature}, body:{mid, subscriptionId} }
```

---

## Refunds - full mapping

| | PayU | Paytm |
|---|---|---|
| Endpoint | `POST /merchant/postservice?form=2` | `POST {PAYTM_PG_DOMAIN}/refund/apply` |
| Command | `command=cancel_refund_transaction` | (no command field; endpoint implies refund) |
| Identifier | `var1=<mihpayid>`, `var2=<token>` (your refund id), `var3=<amount>` | `body.txnId` (Paytm-issued), `body.refId` (your id), `body.refundAmount` |
| Hash field | `sha512(key|command|var1|salt)` | `head.signature` over JSON body |
| Status check | `command=check_action_status&var1=<request_id>` | `POST /v2/refund/status` |
| Idempotency | Pass same `var2` for retries (token-scoped) | Reuse same `refId` (Paytm dedups per `refId`) |
| Speed control | `cancel_refund_transaction` is async; PayU has no speed flag | Not configurable per refund |

---

## Webhooks - signature scheme deep dive

### PayU

Form-encoded POST to your configured endpoint. Hash field embedded in the form values. PayU sometimes posts as `application/x-www-form-urlencoded`, sometimes `multipart/form-data` — accept both.

```
HTTP POST /your/webhook
Content-Type: application/x-www-form-urlencoded
Body: status=success&txnid=...&amount=...&mihpayid=...&hash=...&...
```

Verification: reverse hash exactly as in the surl/furl callback. The same formula.

### Paytm

JSON POST with signature in body.

```
HTTP POST /your/webhook
Content-Type: application/json
Body: { "head": { "signature": "..." }, "body": { "mid", "orderId", "status", ... } }
```

Verification: `PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, signature)`.

### Retry behavior

| | PayU | Paytm |
|---|---|---|
| Retry window | ~24-48 hours, sparse retries | ~7 days, ~10 attempts |
| 2xx stops retries | Yes | Yes |
| Dedup expected | Yes — PayU sends a unique `transaction_id` per event | Yes — dedup on `(orderId, status)` or `(refId, status)` |

---

## Dual-write rollout pattern

Reuse the architecture from `migrate-from-razorpay/references/REFERENCE.md` § Dual-write rollout pattern, with **two PayU-specific tweaks**:

1. **PayU flow blocks the user's tab.** Because PayU is form-POST + redirect, the canary decision is final per attempt — once you've sent the user to `secure.payu.in`, you cannot switch to Paytm mid-flow. Paytm's JS Checkout is in-page so you can retry. Plan canary metrics around this.
2. **Reconcile via `verify_payment`** for PayU orders, **`/v3/order/status`** for Paytm orders. Different shapes — your reconciliation job needs two branches.

```js
// Hash-based canary (same as Razorpay sample)
function shouldUsePaytm(customerId, canaryPct) {
  const hash = crypto.createHash("sha256").update(customerId).digest();
  return (hash.readUInt32BE(0) % 100) < canaryPct;
}
```

For backend code, the Razorpay dual-write sample in `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/` is the template — swap the Razorpay branch for PayU form-POST construction (server renders form, returns to your frontend, frontend submits).

---

## Cutover checklist

When canary at 100% is stable for ≥ 2 weeks:

- [ ] All new orders going to Paytm (JS Checkout for one-time, /subscription/create for recurring).
- [ ] PayU credentials still configured but **only** used for refunds + chargebacks on historical orders.
- [ ] PayU webhooks still wired (you'll receive refund webhooks for in-flight refunds).
- [ ] Refund script knows which gateway each historical order used (`psp_used: "payu" | "paytm"`).
- [ ] PayU SI mandates that are active continue debiting on PayU until naturally expired — do NOT cancel them mid-cycle if you have customers depending on the recurring charge.
- [ ] Customer support team trained on Paytm dashboard.
- [ ] Settlement reconciliation team aware of new schedule (Paytm settlement timing may differ from PayU's).
- [ ] Keep PayU keys live for **120 days minimum** (longer than Razorpay's 90 because of SI mandate lifecycle).
- [ ] After 120 days of clean Paytm operation, rotate PayU keys / cancel the contract.

---

## Common pitfalls when porting

| Bug seen in production | Cause | Fix |
|---|---|---|
| Checksum mismatches everywhere on Paytm side | Developer tried to reuse PayU hash formula, replaced `salt` with `MERCHANT_KEY` | Delete PayU hash code; use `paytmchecksum` |
| Amount mismatch | PayU amount allows up to 2 decimal places, but some integrations sent `100` (int) — Paytm rejects | Always two-decimal string `"100.00"` |
| Surl and furl both unused | PayU has two callback URLs (success / failure), Paytm has one | Paytm reads `STATUS` field in the single `callbackUrl`'s POST body to branch |
| UDF data lost | UDFs (`udf1`-`udf5`) carried business state in PayU | Move to `userInfo.extraParamsMap` or your own DB; Paytm doesn't have a UDF concept |
| SI mandates double-charging | SI continued on PayU while Paytm took over for new mandates | Plan SI handover carefully — don't cancel active SI; let it run out and create new mandate on Paytm at next renewal |
| Webhook signature always fails on Paytm | Developer looking for hash in form data (PayU-style) | Read signature from `body.head.signature` in the JSON |
| Settlement amounts off | PayU deducts MDR inline; Paytm settles gross then debits fees | Reconcile gross + fees separately for the cutover period |

---

## Other source gateways

This skill is PayU-specific. Equivalent skills for other PSPs:

- `migrate-from-razorpay` (shipped)
- `migrate-from-cashfree` (next)
- `migrate-from-juspay` (planned)
- `migrate-from-ccavenue` (planned)
- `migrate-from-billdesk` (planned)
