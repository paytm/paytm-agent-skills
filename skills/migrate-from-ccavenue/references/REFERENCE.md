# CCAvenue → Paytm Migration - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full per-endpoint mapping, AES-256-CBC encryption deep dive with per-language code, SI mapping, refund flow, dual-write rollout, cutover.

---

## CCAvenue product surface

| CCAvenue product | What it is | Paytm replacement |
|---|---|---|
| **Iframe / Custom checkout / Non-Seamless** | Customer redirected to a CCAvenue-hosted page (or iframe), enters card / UPI / NB on their UI | Paytm JS Checkout (`/theia/api/v1/initiateTransaction`) |
| **Direct API (Seamless)** | Card details collected on merchant page, posted directly to CCAvenue (PCI scope on merchant) | Paytm Custom SDK (cards) - similar PCI implications. See `custom-sdk` skill. |
| **Subscription Information (SI)** | Recurring debit configured per cycle/frequency | Paytm NATIVE_SUBSCRIPTION |
| **CCAvenue iOS / Android SDK** | Native SDK wraps the iframe flow | Paytm All-in-One SDK (turn-key) or Custom SDK (custom UI) |
| **CCAvenue Invoice / Smart Forms** | Link-style hosted checkout | Paytm Payment Links (`/link/create`) |
| **Settlements Workflow** | Aggregated settlement, multi-currency for some merchants | Paytm settlement (single-MID, INR for domestic) |

If the merchant uses Iframe + SI, the migration is well-defined. If they use cross-border features or merchant-of-record functionality, evaluate parity with Paytm before proceeding.

---

## Three credentials, not two

CCAvenue requires **three** values where Paytm needs **two**:

| CCAvenue | Purpose | Paytm equivalent |
|---|---|---|
| `merchant_id` | Account identifier | `MID` |
| `access_code` | Sent as a form field, identifies the call origin | (no separate value — `MID` does both roles) |
| `working_key` | AES-256-CBC encryption key (32 chars) | `MERCHANT_KEY` (also used as the signing secret) |

After cutover, only Paytm's two values are needed. Delete the `access_code` env / config — it doesn't translate.

---

## Auth model — every API call

### CCAvenue

```js
// 1. Build the request as a key=value& query string
const plain =
  "merchant_id=" + MERCHANT_ID +
  "&order_id=" + orderId +
  "&currency=INR&amount=" + amount.toFixed(2) +
  "&redirect_url=" + redirectUrl +
  "&cancel_url=" + cancelUrl +
  "&language=EN" +
  "&billing_name=" + billingName +
  "&billing_email=" + billingEmail +
  // ... 15+ billing/shipping fields ...
  "";

// 2. AES-256-CBC encrypt with working_key
const encRequest = ccavenueEncrypt(plain, WORKING_KEY);

// 3. Submit as hidden form to https://secure.ccavenue.com/transaction/transaction.do
//    Form fields: encRequest, access_code
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

Two patterns — not interchangeable. Delete the CCAvenue AES helper during cutover.

---

## AES-256-CBC encrypt / decrypt — per language

CCAvenue's encryption uses:
- Algorithm: **AES-256-CBC** (PKCS5/7 padding)
- Key: **MD5 hash of `working_key`** (32 bytes)
- IV: **fixed value** `0102030405060708090a0b0c0d0e0f10` (16 bytes, hex)

The same helpers live in every CCAvenue codebase. After cutover, **delete these**. They are NOT needed for Paytm. Below they're documented only so you can find and remove them — and so the dual-write phase can keep working until the cutover.

### Node.js

```js
import crypto from "node:crypto";

const IV = Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex");

function ccavenueEncrypt(plain, workingKey) {
  const key = crypto.createHash("md5").update(workingKey).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, IV);
  let enc = cipher.update(plain, "utf8", "hex");
  enc += cipher.final("hex");
  return enc;
}

function ccavenueDecrypt(encText, workingKey) {
  const key = crypto.createHash("md5").update(workingKey).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, IV);
  let dec = decipher.update(encText, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}
```

### Python

```python
import hashlib
from Crypto.Cipher import AES

IV = bytes.fromhex("0102030405060708090a0b0c0d0e0f10")

def _pad(s):
    pad_len = 16 - (len(s) % 16)
    return s + chr(pad_len) * pad_len

def ccavenue_encrypt(plain: str, working_key: str) -> str:
    key = hashlib.md5(working_key.encode()).digest()
    cipher = AES.new(key, AES.MODE_CBC, IV)
    return cipher.encrypt(_pad(plain).encode()).hex()

def ccavenue_decrypt(enc_hex: str, working_key: str) -> str:
    key = hashlib.md5(working_key.encode()).digest()
    cipher = AES.new(key, AES.MODE_CBC, IV)
    raw = cipher.decrypt(bytes.fromhex(enc_hex)).decode("utf-8", errors="ignore")
    return raw.rstrip(chr(raw[-1] and ord(raw[-1]) or 0))
```

### Java

```java
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;

private static final byte[] IV = new byte[]{
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
};

public static String ccavenueEncrypt(String plain, String workingKey) throws Exception {
    byte[] key = MessageDigest.getInstance("MD5").digest(workingKey.getBytes("UTF-8"));
    Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
    c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(IV));
    byte[] enc = c.doFinal(plain.getBytes("UTF-8"));
    StringBuilder hex = new StringBuilder();
    for (byte b : enc) hex.append(String.format("%02x", b));
    return hex.toString();
}

public static String ccavenueDecrypt(String encHex, String workingKey) throws Exception {
    byte[] key = MessageDigest.getInstance("MD5").digest(workingKey.getBytes("UTF-8"));
    Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
    c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(IV));
    byte[] raw = new byte[encHex.length() / 2];
    for (int i = 0; i < raw.length; i++) raw[i] = (byte) Integer.parseInt(encHex.substring(i*2, i*2+2), 16);
    return new String(c.doFinal(raw), "UTF-8");
}
```

These are reference implementations for the dual-write phase — they let you keep CCAvenue running while you move new traffic to Paytm. On cutover, delete them.

---

## Billing / shipping field reduction

CCAvenue collects an extensive customer + delivery field set per request. Paytm requires almost none of it on the API. Build a translator:

| CCAvenue field | Paytm equivalent | Notes |
|---|---|---|
| `billing_name` | (none) | Store in your DB; not sent to Paytm |
| `billing_address` | (none) | Same |
| `billing_city` / `billing_state` / `billing_zip` / `billing_country` | (none) | Same |
| `billing_tel` | `userInfo.mobile` | One field carries phone |
| `billing_email` | `userInfo.email` | One field carries email |
| `delivery_name` / `delivery_address` / `delivery_city` / `delivery_state` / `delivery_zip` / `delivery_country` / `delivery_tel` | (none) | Shipping is purely your DB concern |
| `merchant_param1`..`merchant_param5` | (none) | Use your own metadata store |
| `customer_identifier` | `userInfo.custId` | Sanitize to `[A-Za-z0-9_@-]` |
| `language` | (none) | Paytm UI language is per-MID dashboard config |
| `currency` | `txnAmount.currency` | Always `"INR"` for domestic |
| `amount` | `txnAmount.value` | Two-decimal string `"100.00"` |
| `redirect_url` / `cancel_url` | `callbackUrl` | Paytm uses ONE callback URL; read `STATUS` to branch |
| `tid` | `orderId` | Same direction — your value |

---

## One-time payment — full per-step diff

### Step 1: server creates order

| | CCAvenue | Paytm |
|---|---|---|
| Endpoint | `POST https://secure.ccavenue.com/transaction/transaction.do` (prod) / `https://test.ccavenue.com/...` (test) | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid=...&orderId=...` |
| Auth | AES-256 encrypted `encRequest` form field + `access_code` form field | `head.signature` inside the JSON body |
| Amount | `amount=100.00` (decimal string) | `txnAmount.value: "100.00"` |
| Order id | `order_id` (your id) | `orderId` (your id, `[A-Za-z0-9_@-]`, ≤50 chars) |
| Customer | 15+ billing/shipping fields | `userInfo: { custId, email, mobile }` |
| Returns | (no JSON return; browser redirects to CCAvenue) | `{ body: { txnToken, resultInfo } }` |

### Step 2: frontend payment UI

| | CCAvenue | Paytm |
|---|---|---|
| What user sees | Full-page redirect to CCAvenue hosted checkout (or iframe if iframe variant) | Paytm.CheckoutJS in-page modal (or full-page redirect with `redirect:true`) |
| Frontend work | Render hidden form, JS submit | Load merchant `.js`, call `Paytm.CheckoutJS.init({...}).then(invoke)` |
| Loader script | (no script — CCAvenue is server-rendered) | `{PAYTM_PG_DOMAIN}/merchantpgpui/checkoutjs/merchants/{MID}.js` |
| Customer return | CCAvenue POSTs encrypted `encResp` to `redirect_url` | Paytm POSTs callback to `callbackUrl` (form-encoded) |

See `js-checkout` skill for the Paytm-side pattern (static loader + `merchant: { redirect: true }`).

### Step 3: server-side verification

| | CCAvenue | Paytm |
|---|---|---|
| Where | Your `redirect_url` handler | Your `callbackUrl` handler |
| Verification | AES-decrypt `encResp` → parse `order_status` etc. | `PaytmChecksum.verifySignature(rawBody, KEY, sig)` |
| Source of truth | `/transaction/transaction.do?command=orderStatusTracker` (encrypted) | `/v3/order/status` (head `signature` only) |

---

## CCAvenue endpoint reference (cross-check before generating dual-write code)

CCAvenue uses **different base URLs** for different operations. The dual-write phase must hit the right one per command:

| Operation | Production URL | Staging URL |
|---|---|---|
| Transaction (Non-Seamless, iFrame, Direct Connect) | `https://secure.ccavenue.com/transaction/transaction.do` | `https://test.ccavenue.com/transaction/transaction.do` |
| Order status tracker | `https://api.ccavenue.com/apis/servlet/DoWebTrans` (command `orderStatusTracker`) | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans` |
| Refund | `https://api.ccavenue.com/apis/servlet/DoWebTrans` (command `refundOrder`) | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans` |
| SI status (`getSIStatus`) | `https://login.ccavenue.com/apis/servlet/DoWebTrans` | `https://logintest.ccavenue.com/apis/servlet/DoWebTrans` |
| SI charge list (`getSIChargeList`) | `https://api.ccavenue.com/apis/servlet/DoWebTrans` | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans` |

Form field names also differ between endpoints:
- Transaction endpoint uses `encRequest` (camelCase).
- API endpoints (`DoWebTrans`) use `enc_request` (snake_case) plus `command`, `request_type` (`XML` / `JSON` / `String`), `response_type`, `version` (`1.1`).

After cutover, **all of these collapse to one Paytm endpoint per concept**:

| Concept | All-CCAvenue-endpoints replaced by |
|---|---|
| Transaction | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction` |
| Status check | `POST {PAYTM_PG_DOMAIN}/v3/order/status` |
| Refund | `POST {PAYTM_PG_DOMAIN}/refund/apply` |
| SI status | `POST {PAYTM_PG_DOMAIN}/subscription/status` |
| SI cancel | `POST {PAYTM_PG_DOMAIN}/subscription/cancel` |

Less surface area, fewer URL config keys, single auth scheme. That's the leverage of the migration.

---

## Subscription Information (SI) mapping

CCAvenue SI is a separate product with its own field set. SI registration goes via the same endpoint with additional SI fields, AES encrypted.

### Field mapping

| CCAvenue SI field | Paytm subscription field | Notes |
|---|---|---|
| `si_amount` | `txnAmount.value` | Charge amount per cycle |
| `si_setup_amount` | (use authorization amount on `txnAmount` for the first call) | Paytm doesn't split setup from cycle |
| `si_frequency` + `si_frequency_type` | `subscriptionFrequency` + `subscriptionFrequencyUnit` | See frequency mapping table below |
| `si_start_date` | `subscriptionStartDate` (YYYY-MM-DD, IST) | Paytm rejects past dates; generate today in IST |
| `si_total_count` | `subscriptionExpiryDate` | Compute: `startDate + (count * frequency_in_days)` |
| `si_bill_cycle` | `subscriptionAmountType` (`FIX` / `VARIABLE`) | Map based on whether the amount varies per cycle |

### Frequency mapping

| CCAvenue `si_frequency_type` | Paytm `subscriptionFrequency` + `subscriptionFrequencyUnit` |
|---|---|
| `daily` (frequency = 1) | `1`, `DAY` |
| `weekly` (frequency = 1) | `7`, `DAY` (or `1`, `WEEK` if MID supports) |
| `monthly` (frequency = 1) | `1`, `MONTH` |
| `yearly` (frequency = 1) | `1`, `YEAR` |

`subscriptionGraceDays` must be < cycle length on Paytm — CCAvenue has no such constraint. See `subscriptions` skill rule #17.

### Active SI mandate handover

Do **NOT** cancel active CCAvenue SI mandates on cutover. Let them run their natural cycle on CCAvenue. New mandates only on Paytm. Track the cutover date and the gateway each mandate lives on:

```sql
ALTER TABLE subscriptions ADD COLUMN psp TEXT NOT NULL DEFAULT 'ccavenue';
-- after cutover, new rows insert psp='paytm'
```

After all CCAvenue mandates have either expired or been migrated by customers re-authorising on Paytm, you can rotate the CCAvenue working key and decommission.

---

## Refunds

| | CCAvenue | Paytm |
|---|---|---|
| Endpoint | `POST /transaction/refundOrder.do` (Non-Seamless API) | `POST /refund/apply` |
| Body | `reference_no` + `refund_amount` + `refund_ref_no` + auth params, AES encrypted | JSON `{ body: { txnType: "REFUND", orderId, txnId, refId, refundAmount } }` |
| Identifier returned | `refund_reference_no` (CCAvenue-issued) | `refundId` (Paytm-issued) |
| Idempotency | Pass same `refund_ref_no` for retries | Reuse same `refId` |
| Status check | `orderStatusTracker` command (encrypted) | `POST /v2/refund/status` |
| Webhook event | S2S notification with `order_status` field after decrypt | `/paytm/webhook` with `txnType: "REFUND"` |

---

## Webhooks - signature scheme

### CCAvenue

```
HTTP POST /your/s2s/url
Headers:  Content-Type: application/x-www-form-urlencoded
Body:     encResp=<aes-256-encrypted&hex-encoded payload>
```

Verification = AES decryption + parsing. There is no separate HMAC — possession of the working key is what proves CCAvenue's identity.

### Paytm

```
HTTP POST /your/webhook
Content-Type: application/json
Body: { "head": { "signature": "..." }, "body": { "mid", "orderId", "status", ... } }
```

Verification:
```js
const valid = await PaytmChecksum.verifySignature(rawBody, MERCHANT_KEY, parsed.head.signature);
if (!valid) return res.status(401);
```

---

## Dual-write rollout — CCAvenue specific tweaks

Use the Razorpay dual-write architecture (`migrate-from-razorpay/references/REFERENCE.md` § Dual-write) with these tweaks:

1. **Canary decision is final per attempt.** CCAvenue is full-page redirect — once the user lands on `secure.ccavenue.com`, you cannot switch to Paytm mid-flow. Plan canary metrics around full-flow per-customer pinning.
2. **Two reconcilers.** CCAvenue reconciliation uses `orderStatusTracker` (encrypted body); Paytm uses `/v3/order/status` (JSON + checksum). Different shapes — your reconciliation job needs two branches that both populate a common `status` enum.
3. **Map order_status enum.** CCAvenue uses values like `Successful Transaction`, `Aborted Transaction`, `Awaited Authorization`. Build a translator to Paytm's `TXN_SUCCESS` / `TXN_FAILURE` / `PENDING`.

| CCAvenue `order_status` | Mapped to |
|---|---|
| `Successful Transaction` / `Shipped` | `TXN_SUCCESS` |
| `Aborted Transaction` / `Failure` / `Cancelled` | `TXN_FAILURE` |
| `Awaited Authorization` / `Initiated` | `PENDING` |
| `Refunded` | (refund state, separate from order state) |

---

## Cutover checklist

When canary at 100% is stable for ≥ 4 weeks (CCAvenue is harder to roll back than newer PGs):

- [ ] All new orders going to Paytm.
- [ ] CCAvenue credentials still configured but ONLY for refunds + dispute responses on legacy orders.
- [ ] Active SI mandates on CCAvenue continue running until naturally expired or until the customer re-authorises on Paytm. Don't cancel mid-cycle.
- [ ] Refund script knows the gateway per historical order (`psp_used: "ccavenue" | "paytm"`).
- [ ] Customer support trained on Paytm dashboard.
- [ ] Settlement reconciliation team aware of timing changes.
- [ ] **AES helper modules deleted** from the codebase (the grep in `SKILL.md` § cleanup catches them).
- [ ] **`access_code` env var removed** — Paytm has no equivalent.
- [ ] CCAvenue working key kept live for **150 days minimum** (longer than other migrations because of SI mandate cycle length).
- [ ] After 150 days of clean Paytm operation, rotate working key + cancel contract.

---

## Common pitfalls when porting

| Bug seen | Cause | Fix |
|---|---|---|
| 401 / "Invalid signature" on every Paytm call | Developer kept the AES helper and accidentally encrypted parts of the Paytm body | Delete `ccavenueEncrypt` entirely; Paytm bodies are plain JSON |
| Amount off | Forgot two-decimal-string discipline | `txnAmount.value: "100.00"` always |
| `access_code` rejected on Paytm | Sent as a header / query param on Paytm calls | Remove — Paytm doesn't have it |
| Webhook signature fails | Tried to AES-decrypt Paytm webhook (CCAvenue muscle memory) | Paytm webhooks are JSON; use `PaytmChecksum.verifySignature` |
| SI cycles wrong | CCAvenue `si_total_count` ignored | Translate to `subscriptionExpiryDate` |
| Customer billing data lost | CCAvenue 15+ fields all dropped at the API layer | Persist to your DB before calling Paytm if business needs them |
| Settlement amounts off | CCAvenue deducts MDR inline differently from Paytm | Reconcile gross + fees separately for the cutover quarter |

---

## Other source gateways

- `migrate-from-razorpay` (shipped)
- `migrate-from-payu` (shipped)
- `migrate-from-cashfree` (shipped)
- `migrate-from-juspay` (shipped)
- `migrate-from-billdesk` (next)
