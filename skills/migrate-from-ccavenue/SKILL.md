---
name: paytm-migrate-from-ccavenue
description: >
  Migration playbook for moving from CCAvenue (Avenues India) to Paytm Payment Gateway. CCAvenue
  uses an AES-256 encrypted form-POST flow with three credentials (merchant_id, access_code,
  working_key) — substantially different from Paytm's JSON+checksum REST flow. Covers the
  AES-encrypted-form -> REST JSON shift, request/response encryption translation, Subscription
  Information (SI) -> NATIVE_SUBSCRIPTION, billing/shipping field reduction, refund cancellation
  via the non-seamless API, and dual-write rollout. Load when the user mentions migrating from
  CCAvenue or has CCAvenue integration in the codebase (CCAVENUE_MERCHANT_ID, CCAVENUE_ACCESS_CODE,
  CCAVENUE_WORKING_KEY, AES-256, secure.ccavenue.com, /transaction/transaction.do).
triggers:
  - "ccavenue"
  - "CCAvenue"
  - "cc avenue"
  - "ccavenew"
  - "ccavnue"
  - "ccavanue"
  - "CCAVENUE_MERCHANT_ID"
  - "CCAVENUE_ACCESS_CODE"
  - "CCAVENUE_WORKING_KEY"
  - "secure.ccavenue.com"
  - "test.ccavenue.com"
  - "/transaction/transaction.do"
  - "/transaction/initTrans"
  - "AES-256 ccavenue"
  - "ccavenue working key"
  - "migrate from ccavenue"
  - "switch from ccavenue"
---

# CCAvenue → Paytm Migration

> This skill is split across two files. `SKILL.md` (this file) gives the at-a-glance mapping + per-flow summary. `references/REFERENCE.md` contains the full AES-256 encryption deep dive (encrypt + decrypt code samples in Node / Python / Java), per-step diff, billing/shipping field reduction table, Subscription Information (SI) mapping, refund cancellation flow, dual-write tweaks for form-POST + redirect, and the cutover checklist — all NOT repeated here.
>
> **Do not generate any CCAvenue → Paytm migration code until you have read `references/REFERENCE.md`.**

Use this skill when a merchant has a working CCAvenue integration (often older / enterprise / education / government merchants) and wants to switch to Paytm. CCAvenue's model is fundamentally different from Paytm's — be prepared to rewrite more code than for Razorpay / Cashfree migrations.

---

## At a glance

| Concept | CCAvenue | Paytm |
|---|---|---|
| Identifiers | `merchant_id` + `access_code` + `working_key` (3 values) | `MID` + `MERCHANT_KEY` (2 values) |
| Order create style | **Form-POST** with AES-256 encrypted body string | **REST JSON** with body checksum |
| Frontend | Browser submits encrypted form to CCAvenue, full-page redirect to hosted checkout | JS Checkout script renders in-page modal (or redirects with `redirect:true`) |
| Auth on each call | AES-256 encrypt the entire request body using `working_key` + IV | `head.signature` checksum on JSON body using `MERCHANT_KEY` |
| Endpoint | `POST /transaction/transaction.do` (production) / `test.ccavenue.com` equivalent | `POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction` |
| Response | AES-encrypted `encResp` string in browser POST back to your `redirect_url`; decrypt to get `key=value&...` pairs | Form-encoded callback with `STATUS`, `ORDERID`, `TXNID`, `CHECKSUMHASH` |
| Refund | `POST /transaction/refundOrder.do` (Non-Seamless API), AES-encrypted body | `POST /refund/apply` JSON |
| Subscription | **SI (Subscription Information)** API — separate product, AES encrypted | `POST /subscription/create` (`NATIVE_SUBSCRIPTION`, flat body) |
| Source of truth | `POST /transaction/transaction.do?command=orderStatusTracker` (encrypted) | `POST /v3/order/status` (`head: { signature }` only) |

**Critical mental shift #1:** CCAvenue puts the **entire request body** into AES-256-CBC encryption. Paytm hashes the JSON body and puts the signature *next to* the plain JSON. You delete the AES helper during cutover; Paytm doesn't need it.

**Critical mental shift #2:** CCAvenue collects an extensive billing + shipping field set (15+ fields like `billing_name`, `billing_address`, `billing_city`, `billing_state`, `billing_zip`, `billing_country`, `billing_tel`, `billing_email`, plus the matching shipping_* set, plus `merchant_param1..5`). Paytm requires only `userInfo.custId` and accepts a small `userInfo` envelope. Most CCAvenue billing fields **have no Paytm equivalent** — store them in your own DB if your business needs them.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Greenfield rewrite | **Cutover** — replace the AES-encrypted form + CCAvenue redirect with Paytm REST + JS Checkout | `REFERENCE.md` § Direct cutover |
| Production traffic | **Dual-write canary** — sticky-hash by customer; route % to Paytm | `REFERENCE.md` § Dual-write |
| Active SI mandates on CCAvenue | **Partial migration** — keep existing SI mandates running on CCAvenue until naturally expired; new mandates on Paytm | `REFERENCE.md` § SI handover |

Reference dual-write architecture: `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Swap the source-PSP branch for CCAvenue's encrypted form construction.

---

## Per-flow mapping (high level)

### One-time payments (cards, UPI, NB, EMI)

```
CCAvenue                                            Paytm
─────────                                           ─────
1. Build a key=value&... request string             Build a JSON body
2. AES-256-CBC encrypt with working_key + IV   →    PaytmChecksum.generateSignature(JSON.stringify(body), KEY)
3. Render hidden form:                              POST /theia/api/v1/initiateTransaction
   <form action="https://secure.ccavenue.com/         Content-Type: application/json
         transaction/transaction.do" method="post">    body: { head: { signature }, body: {...} }
     <input name="encRequest"  value="<enc>" />     returns { body: { txnToken } }
     <input name="access_code" value="<code>" />
   </form>
4. Browser submits form -> full-page redirect      Frontend: Paytm.CheckoutJS.init({...}).then(invoke)
5. CCAvenue redirects to redirect_url with         Paytm POSTs callback to callbackUrl with
   encrypted encResp in POST body                    form-encoded STATUS / ORDERID / TXNID / CHECKSUMHASH
6. Decrypt encResp -> parse key=value pairs        Verify CHECKSUMHASH via PaytmChecksum.verifySignature
7. Verify by hitting orderStatusTracker            POST /v3/order/status  (head: { signature } only)
```

→ Load the `js-checkout` skill alongside.

### Subscriptions (SI — Subscription Information)

```
CCAvenue SI                                         Paytm
───────────                                         ─────
1. SI registration via si_charge_request           POST /subscription/create
   AES-encrypted with SI-specific fields              requestType: "NATIVE_SUBSCRIPTION"
   (si_amount, si_frequency, si_frequency_type,       FLAT body (no subscriptionDetails wrapper)
    si_setup_amount, si_bill_cycle, si_start_date,    head: { clientId, channelId, signature }
    si_total_count)                                   query: ?mid=...&orderId=...&traceId=...
2. Customer authorises at CCAvenue page            Customer authorises in Paytm.CheckoutJS mandate UI
3. CCAvenue charges automatically per schedule     Paytm charges per schedule
4. Status: /transaction/transaction.do?            Status: webhook with txnType "SUBSCRIPTION_DEBIT"
   command=siStatus (encrypted)
5. Cancel: si_status_request with                  POST /subscription/cancel
   si_action="cancel"
```

→ Load the `subscriptions` skill alongside.

### Refunds

```
CCAvenue                                            Paytm
─────────                                           ─────
POST /transaction/refundOrder.do               →    POST /refund/apply
  encrypted body: reference_no, refund_amount,        { head: { signature },
                  refund_ref_no, ...                    body: { txnType: "REFUND", orderId, txnId,
                                                                refId, refundAmount } }
Response: encrypted, decrypt to get status         Response: JSON, body.resultInfo.resultStatus
Status: orderStatusTracker command                 POST /v2/refund/status
```

→ Load the `refunds` skill alongside.

### Webhooks / Server-to-Server notifications

```
CCAvenue                                            Paytm
─────────                                           ─────
HTTP POST encrypted encResp in body form       →    HTTP POST { head: { signature }, body: {...} }
Verify: decrypt encResp with working_key,           Verify: PaytmChecksum.verifySignature(rawBody, KEY, sig)
        parse key=value, optional checksum re-do    on the JSON body bytes
Events: status changes inside the decrypted        body.txnType + body.status distinguish
         payload (order_status, refund_status)        "SALE" / "REFUND" / "SUBSCRIPTION_DEBIT" / ...
```

→ Load the `webhooks` skill alongside.

---

## AES-256 vs body checksum — the single biggest change

CCAvenue requires you to **AES-256-CBC encrypt the entire request body**, decrypt the response, and decrypt webhook payloads. This is the workhorse function in every CCAvenue codebase — typically called `ccavenueEncrypt(plaintext, workingKey)` and `ccavenueDecrypt(ciphertext, workingKey)`.

When porting, **delete both functions entirely**. Paytm:
- Does NOT encrypt anything in the request — body is plain JSON.
- Uses `PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY)` to compute a signature, which sits in `body.head.signature`.
- Same library verifies responses.

Common porting bug: developers keep the AES helper "just in case" and silently encrypt parts of the Paytm body, which then fails checksum verification. Symptom: every Paytm call returns 401 / "Invalid signature" with no obvious cause.

---

## When to load related skills

- One-time payment → also load `js-checkout`
- Recurring (SI) → also load `subscriptions`
- Refund → also load `refunds`
- Webhook / S2S → also load `webhooks`
- Errors during migration → `troubleshooting`

---

## ✅ Final step — codebase cleanup scan (mandatory, do not skip)

After all functional code is migrated, run this scan to catch non-functional CCAvenue references:

```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.html" --include="*.json" --include="*.md" \
  --include="*.env*" --include="*.yaml" --include="*.yml" --include="*.java" --include="*.py" \
  "ccavenue\|CCAvenue\|CCAVENUE\|access_code\|working_key\|encRequest\|encResp\|transaction.do\|Avenues India" \
  . 2>/dev/null
```

Common survivors:

| File / Surface | What to replace |
|---|---|
| HTML / JSX footer & copy | "Secured by CCAvenue" / "Powered by Avenues India Ltd." → "Secured by Paytm" |
| `package.json` `description` field | Remove CCAvenue mention |
| `.env.example` placeholders | `CCAVENUE_MERCHANT_ID=...`, `CCAVENUE_ACCESS_CODE=...`, `CCAVENUE_WORKING_KEY=...` → Paytm equivalents |
| `README.md` / docs | Setup steps, screenshots, badges |
| Code comments | `// AES-256-CBC for CCAvenue` / `// decrypt encResp` |
| UI labels / modal titles | "CCAvenue Checkout" → product name |
| AES helper modules | `ccavenueCrypto.js` / `ccaCrypto.py` / `AesCryptUtil.java` — delete entirely after cutover |
| Form action URLs in HTML | `action="https://secure.ccavenue.com/transaction/transaction.do"` removed |
| Translation files (i18n) | `payment.gateway.ccavenue` keys |
| DB schema | `tracking_id`, `bank_ref_no` columns repurposed or remapped to Paytm `txnId` |
| CI / deploy configs | Lingering env-var names |

If any survive after the grep, ship a follow-up commit before declaring the migration complete.
