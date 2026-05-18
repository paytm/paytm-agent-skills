---
name: paytm-migrate-from-billdesk
description: >
  Migration playbook for moving from BillDesk (PG by BillDesk / IndiaIdeas.com) to Paytm Payment
  Gateway. BillDesk merchants typically run one of two flows: the legacy pipe-delimited
  PaymentRequest flow (HMAC-SHA256 checksum on `|`-joined message string) OR the newer Online
  Payment v1.2 API (JWS-signed + JWE-encrypted JSON over `/payments/ve1_2/orders/create`). Covers
  both flows, mapping to Paytm's JSON + checksum REST model, recurring (BillDesk eMandate) ->
  NATIVE_SUBSCRIPTION, refund + status flow, and dual-write rollout. Load when the user mentions
  migrating from BillDesk or has BillDesk integration in the codebase (BILLDESK_MERCHANT_ID,
  BILLDESK_CLIENT_ID, BILLDESK_SECRET_KEY, pgi.billdesk.com, /pgidsk/PGI*, /payments/ve1_2/,
  BdSign JWS, BdJwe payload).
triggers:
  - "billdesk"
  - "BillDesk"
  - "pgi.billdesk.com"
  - "uat.billdesk.com"
  - "/pgidsk/PGIMerchantPayment"
  - "/pgidsk/PGIMerchantRequestHandler"
  - "/pgidsk/PGIQueryController"
  - "/payments/ve1_2/orders/create"
  - "/payments/ve1_2/refunds"
  - "BILLDESK_MERCHANT_ID"
  - "BILLDESK_CLIENT_ID"
  - "BILLDESK_SECRET_KEY"
  - "BILLDESK_CHECKSUM_KEY"
  - "IndiaIdeas"
  - "BdSign"
  - "BdJwe"
  - "BdSignature"
  - "BdTimestamp"
  - "migrate from billdesk"
  - "switch from billdesk"
---

# BillDesk → Paytm Migration

> This skill is split across two files. `SKILL.md` (this file) gives the at-a-glance mapping + per-flow summary covering BOTH BillDesk integration variants. `references/REFERENCE.md` contains the full per-step diff with code samples for the legacy pipe-delimited PaymentRequest flow AND the newer v1.2 JWS+JWE flow, mapping for eMandate / SI recurring, refund + query flows, dual-write tweaks, and the cutover checklist — all NOT repeated here.
>
> **Do not generate any BillDesk → Paytm migration code until you have read `references/REFERENCE.md`.**

Use this skill when a merchant has a working BillDesk integration and wants to move to Paytm. BillDesk merchants are usually older / banking / utility-bill / enterprise — be prepared for either of the two coexisting BillDesk integration models in the same codebase.

---

## Which BillDesk flow does the merchant use?

Detect FIRST — they're substantially different on the wire:

| Signal in code | Flow | Notes |
|---|---|---|
| Pipe-delimited `msg` field, `BDPG` HTTP forms, `/pgidsk/PGIMerchantPayment`, HMAC-SHA256 hash appended to `|`-joined string | **Legacy PaymentRequest** (still very common) | String-based, single message field, hash at the end |
| `/payments/ve1_2/orders/create`, `BdSignature` / `BdTimestamp` / `BdJwe` headers, JWS-signed JSON body, JWE-encrypted payload | **Online Payment v1.2 (JWS+JWE)** (newer, post-2021) | JSON, HTTP headers, JOSE-based crypto |

Most BillDesk merchants migrating to Paytm are still on the legacy flow. The v1.2 flow is newer and more common with enterprise merchants who refreshed integrations after 2021. Generate Paytm code that replaces whichever the merchant has — both end up as the same Paytm JSON + body-checksum REST shape.

---

## At a glance

| Concept | BillDesk (Legacy) | BillDesk (v1.2 JWS+JWE) | Paytm |
|---|---|---|---|
| Identifiers | `MerchantID` + `SecurityID` + `ChecksumKey` | `MerchantID` + `ClientID` + `SecretKey` | `MID` + `MERCHANT_KEY` |
| Order create | HTML form POST with pipe-delimited `msg` field | `POST /payments/ve1_2/orders/create` with JWS body | `POST /theia/api/v1/initiateTransaction` |
| Auth | HMAC-SHA256 hash appended to message string with `|` | `BdSignature` header (HMAC-SHA256 of JWS body), JWE-encrypted body | `head.signature` in JSON body |
| Frontend | Browser submits form, full-page redirect to BillDesk hosted checkout | Redirect to JWS-encoded URL or direct integration | Paytm JS Checkout in-page modal (or `redirect: true`) |
| Response | Pipe-delimited `msg` POSTed back to your `ReturnURL` | JWE-encrypted JSON callback | Form-encoded callback with `CHECKSUMHASH` |
| Refund | `POST /pgidsk/PGIQueryController` with refund command | `POST /payments/ve1_2/refunds` | `POST /refund/apply` |
| Status / query | `POST /pgidsk/PGIQueryController` with query command | `POST /payments/ve1_2/orders/{order_id}` | `POST /v3/order/status` |
| Recurring (eMandate / SI) | `MandateRegister` API, separate eMandate flow | v1.2 mandate APIs | `POST /subscription/create` (NATIVE_SUBSCRIPTION, flat body) |
| Source of truth | PGIQueryController response (parse pipe-delimited) | `/payments/ve1_2/orders/{order_id}` response | `/v3/order/status` (head: `signature` only) |

**Critical mental shift #1 (legacy flow):** BillDesk's whole legacy protocol is a **single pipe-delimited string** — `MerchantID|CustomerID|TxnReferenceNo|TxnAmount|BankID|...|ReturnURL|Checksum`. There are no JSON keys. Position matters. Paytm is structured JSON. Don't try to share parsers.

**Critical mental shift #2 (v1.2 flow):** v1.2 uses **JOSE** (JWS + JWE) — you compute a JSON Web Signature with HMAC-SHA256, then JWE-encrypt the payload. Paytm uses neither. Delete the JOSE library after cutover; it's not adaptable.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Greenfield rewrite | **Cutover** — replace BillDesk flow with Paytm REST + JS Checkout in one release | `REFERENCE.md` § Direct cutover |
| Production traffic | **Dual-write canary** — sticky-hash by customer; route % to Paytm | `REFERENCE.md` § Dual-write |
| Active eMandates on BillDesk | **Partial migration** — keep existing mandates running on BillDesk until naturally expired; new mandates on Paytm | `REFERENCE.md` § eMandate handover |

Reference dual-write architecture: `scripts/backend-{node,python,spring,spring-legacy}/razorpay-migration/`. Swap the source-PSP branch for BillDesk's PaymentRequest construction (legacy) or v1.2 JWS+JWE (newer).

---

## Per-flow mapping (high level)

### One-time payments

```
BillDesk Legacy                                     Paytm
───────────────                                     ─────
1. Build pipe-delimited msg:                  →     POST /theia/api/v1/initiateTransaction
   "MerchantID|CustomerID|NA|Amount|NA|NA|NA|         body: { head: { signature }, body: {...} }
    INR|NA|R|SecurityID|NA|NA|F|NA|NA|NA|NA|NA|
    ReturnURL"
2. Append HMAC-SHA256 hash with ChecksumKey   →     Compute via PaytmChecksum.generateSignature
3. Render <form> POST to /pgidsk/                  Frontend: Paytm.CheckoutJS.init({...}).then(invoke)
   PGIMerchantPayment
4. Browser redirects to BillDesk hosted page  →     Paytm.CheckoutJS modal (or redirect:true)
5. BillDesk POSTs result to ReturnURL with    →     Paytm POSTs to callbackUrl with
   pipe-delimited msg + appended hash                form-encoded fields + CHECKSUMHASH
6. Verify by splitting + re-hashing            →     Verify with PaytmChecksum.verifySignature
7. Confirm via PGIQueryController              →     Confirm via /v3/order/status
```

```
BillDesk v1.2 JWS+JWE                               Paytm
──────────────────────                              ─────
1. Build JSON order body                      →     Build JSON body
2. Sign as JWS (HS256) with SecretKey         →     PaytmChecksum.generateSignature on body
3. Encrypt JWS as JWE (A128CBC-HS256 / dir)   →     (no encryption — Paytm uses plain JSON)
4. POST /payments/ve1_2/orders/create         →     POST /theia/api/v1/initiateTransaction
   Headers: BdSignature, BdTimestamp, BdJwe          Headers: Content-Type: application/json
5. Response is JWE-encrypted JSON;            →     Response is plain JSON; body.txnToken
   decrypt -> JWS -> verify -> JSON payload
6. Frontend uses returned URL (hosted) OR     →     Paytm.CheckoutJS.init({...}).then(invoke)
   integrated SDK flow
7. Webhook is JWS-signed JSON callback        →     Webhook is JSON; head.signature for verify
```

→ Load the `js-checkout` skill alongside for the Paytm-side pattern.

### Recurring (eMandate / SI)

```
BillDesk                                            Paytm
─────────                                           ─────
1. Legacy: MandateRegister API with           →     POST /subscription/create
   bank-issued eMandate (NPCI rails)                  requestType: "NATIVE_SUBSCRIPTION"
   v1.2: mandate registration via /payments/ve1_2/    head: { clientId, channelId, signature }
2. Customer authorises mandate at bank             Customer authorises in Paytm.CheckoutJS mandate UI
3. BillDesk debits per schedule                    Paytm debits per schedule
4. Notification: pipe-delimited or v1.2 JSON       Webhook: txnType: "SUBSCRIPTION_DEBIT"
5. Cancel via MandateCancel API                    POST /subscription/cancel
```

→ Load the `subscriptions` skill alongside.

### Refunds

```
BillDesk                                            Paytm
─────────                                           ─────
Legacy: POST /pgidsk/PGIQueryController       →     POST /refund/apply
   refundCommand=RefundTxn|MerchantID|                { head: { signature },
   TxnReferenceNo|Amount|Reason|Checksum                body: { txnType: "REFUND", orderId, txnId,
v1.2: POST /payments/ve1_2/refunds with JWS                 refId, refundAmount } }
Response: pipe-delimited (legacy) or JWE (v1.2)   Response: JSON; body.resultInfo.resultStatus
```

→ Load the `refunds` skill alongside.

### Webhooks / S2S notifications

```
BillDesk                                            Paytm
─────────                                           ─────
HTTP POST                                     →     HTTP POST { head: { signature }, body: {...} }
Legacy: pipe-delimited msg + checksum               Verify via PaytmChecksum.verifySignature
v1.2: JWS-signed JSON OR JWE-encrypted JSON         on the raw JSON body bytes
Verify legacy by splitting + re-HMAC-SHA256;
verify v1.2 by JWS verify + JWE decrypt
```

→ Load the `webhooks` skill alongside.

---

## When to load related skills

- One-time payment → also load `js-checkout`
- Recurring (eMandate / SI) → also load `subscriptions`
- Refund → also load `refunds`
- Webhook → also load `webhooks`
- Mobile SDK (BillDesk SDK → Paytm SDK) → also load `all-in-one-sdk` or `custom-sdk`
- Errors during migration → `troubleshooting`

---

## ✅ Final step — codebase cleanup scan (mandatory, do not skip)

After all functional code is migrated, run this scan to catch non-functional BillDesk references:

```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.html" --include="*.json" --include="*.md" \
  --include="*.env*" --include="*.yaml" --include="*.yml" --include="*.java" --include="*.py" \
  "billdesk\|BillDesk\|BILLDESK\|pgidsk\|PGIMerchantPayment\|PGIQueryController\|BdSignature\|BdJwe\|IndiaIdeas\|ve1_2" \
  . 2>/dev/null
```

Common survivors:

| File / Surface | What to replace |
|---|---|
| HTML / JSX footer & copy | "Secured by BillDesk" / "Powered by IndiaIdeas.com" → "Secured by Paytm" |
| `package.json` `description` field | Remove BillDesk mention |
| `.env.example` placeholders | `BILLDESK_MERCHANT_ID=...`, `BILLDESK_CLIENT_ID=...`, `BILLDESK_SECRET_KEY=...`, `BILLDESK_CHECKSUM_KEY=...` → Paytm equivalents |
| `README.md` / docs | Setup steps, screenshots, badges |
| Code comments | `// pipe-delimited msg` / `// JWS sign for BillDesk` |
| UI labels / modal titles | "BillDesk Checkout" → product name |
| JOSE / pipe-parsing helpers | `bdSign.js` / `bdJwe.py` / `BillDeskMessageBuilder.java` — delete entirely after cutover |
| Form action URLs in HTML | `action="https://pgi.billdesk.com/pgidsk/PGIMerchantPayment"` removed |
| Translation files (i18n) | `payment.gateway.billdesk` keys |
| DB schema | `TxnReferenceNo`, `BankReferenceNo` columns repurposed or remapped to Paytm `txnId` |
| CI / deploy configs | Lingering env-var names |

If any survive after the grep, ship a follow-up commit before declaring the migration complete.
