---
name: paytm-migrate-from-payu
description: >
  Migration playbook for moving from PayU India (PayU Money / PayU Biz / Enterprise) to Paytm
  Payment Gateway. Covers the form-POST checkout model -> Paytm's JS Checkout JSON model,
  PayU's hash scheme (SHA-512 over pipe-joined string) -> Paytm checksum, recurring
  payments, refunds, and dual-write rollout. Load when the user mentions migrating,
  switching, or moving from PayU to Paytm, or has an existing PayU integration in the
  codebase (e.g. PayU_MERCHANT_KEY, PAYU_SALT, payu.in URLs, code calling /_payment,
  bolt.payu.in script, or computing hashes with `key|txnid|amount|...`).
triggers:
  # Code-context signals
  - "payu"
  - "PayU"
  - "payumoney"
  - "PAYU_MERCHANT_KEY"
  - "PAYU_SALT"
  - "payu.in"
  - "test.payu.in"
  - "secure.payu.in"
  - "bolt.payu.in"
  - "/_payment"
  - "payu-india"
  - "payu-business"
  - "mihpayid"
  - "sha512"
  # Direct migration intent
  - "migrate from payu"
  - "migrating from payu"
  - "migration from payu"
  - "payu to paytm"
  - "payu → paytm"
  - "payu -> paytm"
  - "from payu to paytm"
  - "switch from payu"
  - "switching from payu"
  - "move from payu"
  - "moving from payu"
  - "port from payu"
  - "shift from payu"
  - "transition from payu"
  - "swap payu"
  - "replace payu"
  - "replacing payu"
  - "remove payu"
  - "drop payu"
  - "ditch payu"
  - "leave payu"
  - "exit payu"
  - "retire payu"
  - "phase out payu"
  - "migrate from payumoney"
  - "switch from payumoney"
  - "payumoney to paytm"
  - "migrate from payu biz"
  # Merchant conversational
  - "want to use paytm instead of payu"
  - "thinking of switching from payu"
  - "considering paytm over payu"
  - "payu alternative"
  - "payumoney alternative"
  - "alternative to payu"
  - "instead of payu"
  - "unhappy with payu"
  - "payu not working for us"
  - "payu account suspended"
  - "payu settlement delay"
  - "payu support bad"
  - "change payment gateway from payu"
  - "change pg from payu"
  - "stop using payu"
  - "get rid of payu"
  - "dual write payu paytm"
---

# PayU → Paytm Migration

Use this skill when a merchant has a working PayU India integration (any of PayU Money, PayU Biz, PayU Enterprise) and wants to move to Paytm. Covers the API mental-model shift, hash → checksum translation, recurring payments, refunds, and dual-write rollout.

> This skill is split across two files. `SKILL.md` (this file) gives the at-a-glance mapping + per-flow summary. `references/REFERENCE.md` contains the 3 PayU product flavors (Biz / Money / Bolt), the full forward + reverse SHA-512 hash deep dive (with the empty-UDF padding rule), per-step code diff, SI mandate handover (don't cancel active mandates), refund + webhook scheme deep dive, dual-write tweaks for form-POST flow, and 120-day cutover checklist — all NOT repeated here.
>
> **Do not generate any PayU → Paytm migration code until you have read `references/REFERENCE.md`.**

---

## At a glance

| Concept | PayU | Paytm |
|---|---|---|
| Identifier | `merchant_key` + `salt` | `MID` + `MERCHANT_KEY` |
| Request style | **Form-POST** to a checkout URL (`_payment`) | **JSON REST** to API endpoints (`/theia/api/v1/...`) |
| Frontend | Browser POSTs a form directly to PayU's checkout page (full-page redirect) | JS Checkout script renders an in-page modal |
| Auth | Hash field in the form: `SHA-512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)` | Body checksum in `head.signature` via the Paytm checksum library |
| Response | HTTP POST callback to your `surl`/`furl` with all form fields + reverse hash | HTTP POST callback to your `callbackUrl` with form-encoded fields + `CHECKSUMHASH` |
| Source of truth | `POST /merchant/postservice?form=2` with `command=verify_payment` | `POST /v3/order/status` (head: `signature` only) |
| Refund | `POST /merchant/postservice?form=2` with `command=cancel_refund_transaction` | `POST /refund/apply` |
| Subscription | PayU Recurring (`command=create_invoice_recurring_payments`) | `POST /subscription/create` (NATIVE_SUBSCRIPTION) |

**Critical mental shift:** PayU's whole flow is **form-POST + redirect**. You build an HTML form on your server, submit it to PayU, the customer pays on PayU's page, PayU POSTs back to your `surl`. Paytm's flow is **REST + JS Checkout**: you call an API to mint a token, then a JS modal opens in your page. Porting requires re-architecting the frontend, not just renaming fields.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Greenfield rewrite | **Cutover** — replace PayU form-POST with Paytm REST + JS Checkout in one release | `REFERENCE.md` § Direct cutover |
| Production traffic | **Dual-write canary** — route % of new orders to Paytm using a sticky hash | `REFERENCE.md` § Dual-write |
| Need both running long-term | **Permanent dual-rail** | `REFERENCE.md` § Permanent dual-rail |

Reference dual-write implementation (generic — adapt from the Razorpay sample): `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Same architecture, swap PayU's `_payment` form-POST for Razorpay's `orders.create` in the source-PSP branch.

---

## Per-flow mapping (high level)

Each row corresponds to a focused mapping section in `references/REFERENCE.md`. Don't generate code from this table alone — read the matching reference section.

### One-time payments (cards, UPI, NB, EMI)

```
PayU                                                Paytm
────                                                ─────
1. Build form server-side with hash            →    Server: POST /theia/api/v1/initiateTransaction
   <form action="https://secure.payu.in/_payment"     -> returns txnToken
         method="post">
     hidden fields: key, txnid, amount, productinfo,
     firstname, email, surl, furl, hash, etc.

2. Browser submits form -> full-page redirect →    Browser: Paytm.CheckoutJS.init({...}).then(invoke)
                                                       -> in-page modal, can fall back to redirect:true

3. PayU POSTs callback to surl/furl            →    Paytm POSTs callback to callbackUrl
   verify reverse hash: SHA-512(salt|status|...|key)   verify CHECKSUMHASH via PaytmChecksum.verifySignature

4. Server-side verify:                         →    Server: POST /v3/order/status
   POST /merchant/postservice?form=2                  head: { signature } ONLY
       command=verify_payment&var1=<txnid>
```

→ Load the `js-checkout` skill alongside for full Paytm-side flow.

### Recurring payments (auto-debit / SI)

```
PayU                                                Paytm
────                                                ─────
1. Initial customer auth                       →    POST /subscription/create
   POST /_payment with                                 requestType: "NATIVE_SUBSCRIPTION"
       enforce_paymethod=creditcard                    head: { clientId, channelId, signature }
       store_card_token=1                              FLAT body (no subscriptionDetails wrapper)
       si=1 (standing instruction flag)                query: ?mid=...&orderId=...&traceId=...
       si_details JSON (frequency, amount, dates)

2. PayU creates SI mandate at issuing bank     →    Paytm creates UPI Autopay / eMandate
3. Recurring debit by PayU per schedule        →    Recurring debit by Paytm per schedule
4. Webhook on each charge attempt              →    Webhook with txnType: "SUBSCRIPTION_DEBIT"
5. Cancel: command=cancel_si                   →    Cancel: /subscription/cancel
```

→ Load the `subscriptions` skill alongside.

### Refunds

```
PayU                                                Paytm
────                                                ─────
POST /merchant/postservice?form=2              →    POST /refund/apply
  command=cancel_refund_transaction                  { head: { signature },
  var1=<paymentId>                                     body: { txnType: "REFUND", orderId, txnId,
  var2=<token>                                                 refId, refundAmount: "50.00" } }
  var3=<amount>
  hash=...

Response: status, mihpayid, request_id            Response: resultStatus, refundId

Status: command=check_action_status            →    POST /v2/refund/status
```

→ Load the `refunds` skill alongside.

### Webhooks

```
PayU                                                Paytm
────                                                ─────
HTTP POST form-encoded body                    →    HTTP POST JSON body
Hash field embedded in form values                  Signature inside body.head.signature
Verify: reverse SHA-512                             Verify: PaytmChecksum.verifySignature(rawBody, KEY, sig)

Events arrive as form-POST with status,            Events in JSON; distinguish by body.txnType:
mihpayid, productinfo, amount, etc.                  "SALE" / "REFUND" / "SUBSCRIPTION_DEBIT" / ...
```

→ Load the `webhooks` skill alongside.

---

## Hash scheme — the deepest behavioral change

**PayU uses a pipe-joined hash, NOT a checksum library.** The order matters, every field is concatenated with `|`, and trailing empty UDFs (`udf6`-`udf10`) produce a specific number of empty `||` separators. Get the field count wrong and the hash fails silently.

**Forward hash (request) — fixed 16-field formula:**
```
sha512(
  key + "|" + txnid + "|" + amount + "|" + productinfo + "|" +
  firstname + "|" + email + "|" +
  udf1 + "|" + udf2 + "|" + udf3 + "|" + udf4 + "|" + udf5 + "|" +
  "" + "|" + "" + "|" + "" + "|" + "" + "|" + "" + "|" +
  salt
)
```

**Reverse hash (response) — uses the SAME fields in REVERSE order with status prepended:**
```
sha512(
  salt + "|" + status + "|" + "" + "|" + "" + "|" + "" + "|" + "" + "|" + "" + "|" +
  udf5 + "|" + udf4 + "|" + udf3 + "|" + udf2 + "|" + udf1 + "|" +
  email + "|" + firstname + "|" + productinfo + "|" + amount + "|" + txnid + "|" + key
)
```

When porting, **delete this code entirely.** Paytm uses `PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY)` — a library call over the JSON body. The signature lives inside the JSON body (`head.signature`), not in a form field. Don't try to translate the PayU formula.

---

## What "field translation" looks like in practice

| PayU form field | Paytm equivalent | Notes |
|---|---|---|
| `key` | `mid` (in query string + body) | PayU's key is your merchant identifier |
| `txnid` | `orderId` (in query string + body) | Must be unique per attempt; regenerate on retry |
| `amount` | `txnAmount.value` | PayU = decimal string `"100.00"`; Paytm same |
| `productinfo` | (no direct equivalent) | Drop or store as your own metadata |
| `firstname` / `email` | `userInfo.firstName` / `userInfo.email` | Paytm has a `userInfo` envelope |
| `phone` | `userInfo.mobile` | Same field, different name |
| `surl` / `furl` | `callbackUrl` | Paytm uses ONE callback URL for both success + failure (read `STATUS` field to distinguish) |
| `hash` | `head.signature` | Signature mechanism completely different — see hash section above |
| `udf1`…`udf5` | (no direct equivalent) | Use `userInfo.extraParamsMap` or your own DB |
| `service_provider` | (handled per dashboard config) | Paytm picks acquirer automatically |
| `pg` (channel hint) | `channelId` (`WEB`/`WAP`) + dashboard config | Paytm's channel selection is API-side, not form-side |

Full table including subscription, refund, and recurring-specific fields in `references/REFERENCE.md`.

---

## Test plan before going live

1. **Pre-cutover:** Paytm staging integration works end-to-end for every flow you currently use on PayU. Test cards: `4111 1111 1111 1111` (one-time), `4761 3600 7586 3216` (subscription mandate). UPI only via Paytm staging consumer app.
2. **Canary 5%** → 25% → 50% → 100% over 3-4 weeks. Sticky-hash routing by customer id keeps a given customer pinned to one PSP across retries.
3. **Reconciliation report** daily: for each new order, verify both gateways' final state matches your DB. Discrepancy threshold < 0.1%.
4. **Cutover:** stop sending new traffic to PayU. Keep PayU credentials live for 90 days for refunds on legacy orders.

Full reconciliation script + cutover checklist in `references/REFERENCE.md`.

---

## ✅ Final step — codebase cleanup scan (mandatory, do not skip)

After all functional code is migrated, run this scan to catch non-functional PayU references:

```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.html" --include="*.json" --include="*.md" \
  --include="*.env*" --include="*.yaml" --include="*.yml" \
  "payu\|PayU\|PAYU\|mihpayid\|bolt.payu\|_payment\b" \
  . 2>/dev/null
```

Common survivors:

| File / Surface | What to replace |
|---|---|
| HTML / JSX footer & copy | "Powered by PayU" → "Secured by Paytm" |
| `package.json` `description` field | Remove "PayU" mention |
| `.env.example` placeholders | `PAYU_MERCHANT_KEY=...`, `PAYU_SALT=...` → `PAYTM_MID=...`, `PAYTM_MERCHANT_KEY=...` |
| `README.md` / docs | Setup steps, screenshots, badges |
| Code comments | `// reverse hash for PayU surl` / `// SHA-512 pipe` |
| UI labels / modal titles | "PayU Checkout" → product name |
| Form action URLs in HTML | `action="https://secure.payu.in/_payment"` removed |
| `mihpayid` field references in DB schema / models | Replace with Paytm `txnId` mapping |
| Translation files (i18n) | `payment.gateway.payu` keys |
| CI / deploy configs | Lingering env-var names |

If any survive after the grep, ship a follow-up commit before declaring the migration complete.

---

## When to load related skills

This skill is the **migration translator**. For Paytm-side details, always pair with the relevant flow skill:

- One-time payment → also load `js-checkout`
- Recurring payments → also load `subscriptions`
- Refund migration → also load `refunds`
- Webhook migration → also load `webhooks`
- Mobile SDK migration (PayU Money SDK → Paytm) → also load `all-in-one-sdk` or `custom-sdk`
- Errors during migration → also load `troubleshooting`
