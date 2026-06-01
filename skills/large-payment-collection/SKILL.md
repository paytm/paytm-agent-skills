---
name: paytm-large-payment-collection
description: >
  Paytm Large Payment Collection (Bank Transfer) — accept high-ticket payments via NEFT / RTGS / IMPS
  (UPI also supported in the Checkout flow) using a unique 18-char Virtual Account Number (VAN) per customer / order.
  Paytm auto-reconciles the inbound bank transfer to the right VAN, fires a webhook with full remitter
  details, and settles T+1. Two integration shapes: the **Checkout flow** (default — order-based VAN issued via
  /initiateTransaction, surfaced inside the Paytm JS Checkout modal) and the **Non-Checkout flow** (server-only
  permanent VANs via the vanproxy API for ongoing collections — BFSI, schools, distributors, subscriptions). Covers
  Create VAN, Query VAN, Update VAN (disable / TPV), VAN List, Order List, Transaction Status,
  Refund, Refund Status, and payment / refund webhooks. Load this skill for "bank transfer collection",
  "virtual account", "VAN", "NEFT/RTGS/IMPS collection", "large payment", "bulk collection",
  "fee collection", "invoice bank transfer".
triggers:
  - "Large Payment Collection"
  - "large-payment-collection"
  - "Bank Transfer"
  - "Virtual Account"
  - "Virtual Account Number"
  - "VAN"
  - "vanId"
  - "merchantPrefix"
  - "identificationNo"
  - "/van/create"
  - "/van/query"
  - "/van/update"
  - "/van/list"
  - "/van/orderList"
  - "/van/transactionStatus"
  - "/van/refund"
  - "vanInfo"
  - "vanDetails"
  - "vanproxy"
  - "/vanproxy/"
  - "thirdPartyValidation"
  - "TPV"
  - "PYTM0123456"
  - "One97 Communications Limited"
  - "NEFT collection"
  - "RTGS collection"
  - "IMPS collection"
  - "bulk bank transfer"
  - "fee collection"
  - "school fee"
  - "distributor collection"
  - "BFSI collection"
  - "invoice bank transfer"
  - "remitterAccount"
  - "remitterIFSC"
---

> **Dependencies:** This skill covers the VAN/bank-transfer layer only. The Checkout flow also requires the `paytm-js-checkout` skill for the modal fallback. Load both skills when implementing the Checkout flow. The JS Checkout skill covers: loading CheckoutJS script, initialising `Paytm.CheckoutJS` with `txnToken`, handling `transactionStatus`, `notifyMerchant`, `SESSION_EXPIRED`, and `APP_CLOSED` events.

# Paytm Large Payment Collection (Bank Transfer)

Accept large-ticket payments via **NEFT / RTGS / IMPS** by handing each customer / order a unique **18-character Virtual Account Number (VAN)**. The customer pushes money from their bank → Paytm reconciles it to the VAN → you get a signed webhook with full remitter details → Paytm settles to your bank on **T+1**.

> Two files: `SKILL.md` (this) gives the endpoint family, VAN structure, and the highest-impact gotchas. `references/REFERENCE.md` has full per-endpoint field tables, TPV deep dive, error code table, and reconciliation patterns.
>
> **Do not generate any VAN / bank-transfer code until you have read `references/REFERENCE.md`.**

> **🟢 DEFAULT = Checkout flow (Order-based VAN via JS Checkout / `/initiateTransaction` + `vanInfo`).**
>
> When the user asks for "Large Payment Collection", "Paytm Bank Transfer", VAN, NEFT/RTGS collection, or anything in the trigger list, generate **Checkout flow** code by default — i.e. call `POST /theia/api/v1/initiateTransaction` with a `vanInfo` block, get `txnToken`, and render the standard Paytm JS Checkout. Bank Transfer surfaces as a payment option **inside the Paytm checkout modal** alongside UPI / Credit Cards / Debit Cards / Net Banking / EMI; when the payer picks it, the modal shows them the generated VAN + IFSC + beneficiary + amount + countdown.
>
> Only fall back to the Non-Checkout flow (standalone `/van/create` server-only flow, no checkout modal) when the user explicitly asks for ongoing / multi-payment collections against a permanent VAN (e.g. school fees per student, distributor ledger, BFSI investor account with TPV).

---

## ⚠️ Pre-flight : confirm ALL of these before writing a single line of code

- [ ] **LPC activated on this MID?** : Confirm with Paytm KAM. If not, stop here.
- [ ] **`merchantPrefix` confirmed?** : 4 chars, assigned by Paytm at activation. Permanent.
- [ ] **`identificationNo` scheme?** : `MERCHANT_MANAGED` (you supply 10 chars) or `PAYTM_MANAGED`.
- [ ] **`orderTimeout` value?** : Seconds the VAN stays alive (e.g. `3600`).
- [ ] **`websiteName` correct?** : Staging: `WEBSTAGING`. Production: `DEFAULT` or your registered name.
- [ ] **Webhook URL registered and publicly accessible?** : `localhost` will not work.

---

## When to pick this over JS Checkout / Payment Links

| You need… | Use |
|---|---|
| Tuition fees, distributor dues, B2B invoices, BFSI investments, ticket > ₹2L | **Large Payment Collection** |
| Consumer card / UPI checkout on a website / app | `paytm-js-checkout` |
| Shareable shortUrl via SMS / WhatsApp | `paytm-payment-links` |
| In-store scan-to-pay | `paytm-qr-codes` |

Large Payment Collection is the only flow that lets the payer push from **their own bank's net-banking / branch / corporate portal** — no Paytm-hosted page, no card, no UPI app required.

---

## Two flows

| Flow | When | VAN lifetime |
|---|---|---|
| **Non-Checkout flow — Pre-created VANs** | Ongoing collections (fees, distributors, subscriptions). One VAN per customer, no amount validation. Customer can pay any amount, any time. | Permanent (until you `DISABLE` it) |
| **Checkout flow — Order-based VANs** | One-shot orders with a known amount. Payment must match `txnAmount`; VAN expires after `orderTimeout`. Supports UPI in addition to NEFT/RTGS/IMPS. | Until `orderTimeout` expires |

**Default: Checkout flow.** It plugs Bank Transfer into the standard JS Checkout modal, so the merchant gets one unified checkout surface (UPI / Credit Cards / Debit Cards / Net Banking / EMI **+ Bank Transfer**) for high-ticket orders. Use Non-Checkout flow only when the merchant explicitly wants a permanent, server-only VAN per customer (school fees, distributor ledger, BFSI with TPV) and is NOT rendering a checkout modal at all.

---

## Complete end-to-end flow : Checkout flow

1. Customer adds items to cart and enters 10-char `identificationNo` → clicks Pay
2. Frontend validates `identificationNo` is exactly 10 chars; saves cart + `identificationNo` to `sessionStorage`
3. Frontend calls your server's create-order endpoint with `{ items, identificationNo }`
4. Server validates inputs, generates `orderId`, builds `initiateTransaction` request body with `vanInfo` block + `callbackUrl`
5. Server generates Paytm checksum: `PaytmChecksum.generateSignature(JSON.stringify(bodyObj), MERCHANT_KEY)` and wraps as `{ body: bodyObj, head: { signature } }`
6. Server calls `POST /theia/api/v1/initiateTransaction?mid=...&orderId=...`
7. Paytm returns `txnToken` + `vanDetails` (only if LPC is activated on the MID)
8. Server stores order with `status: PENDING` and returns `txnToken`, `vanDetails`, `pgDomain`, `mid` to frontend
9. Frontend null-checks `vanDetails` : if present: show custom VAN screen + start polling; if absent: open Paytm JS Checkout modal
10. Customer selects Bank Transfer in modal → verifies mobile via OTP → sees VAN details → clicks Proceed
11. Customer initiates NEFT / RTGS / IMPS from their bank to the VAN
12. **Browser callback (best-effort):** Paytm POSTs `{ ORDERID, STATUS }` to `callbackUrl` → server redirects to `/?orderId=...&cbStatus=...` → page reloads → frontend restores cart + `identificationNo` from `sessionStorage`
13. **S2S Webhook (reliable):** Paytm fires signed `PAYMENT_SUCCESS` to your webhook URL → server ACKs HTTP 200 within 5s → verifies HMAC-SHA256 signature → marks order `SUCCESS`
14. Frontend polls `/api/order-status` every 10s → detects `SUCCESS` → shows confirmation screen
15. T+1 settlement : Paytm settles amount to merchant's bank account next working day

---

## VAN structure : the 18-character format

```
P P S L [M E R C H A N T] [I D E N T I F I C A T I O N N O]
└──┬───┘ └─────┬─────────┘ └──────────────┬────────────────┘
"PPSL"   4 chars             10 chars
fixed    merchant prefix     unique per customer / order
```

- **Position 1–4:** Fixed `"PPSL"` (Paytm bank identifier : never changes).
- **Position 5–8:** 4-char merchant prefix assigned by Paytm at LPC activation (e.g. `ALIS`, `FITS`).
- **Position 9–18:** 10-char identification number : merchant-managed (you supply it) or Paytm-managed.

**Fixed for every VAN you ever issue:**
- IFSC: `UTIB0CCH274`
- Beneficiary name: `Paytm Payments Services Ltd.`

> Always render values from the API response (`vanDetails.ifsc`, `vanDetails.beneficiaryName`). Never hardcode these : Paytm may update them.

Display all three (`vanId`, IFSC, beneficiary) to the payer : banks reject NEFT/RTGS without all three.

---

## Endpoint family

**Non-Checkout flow uses a single `vanproxy` endpoint** — all VAN operations (create / query / update) are routed through the same URL; the `body` discriminates the operation.

| Environment | Endpoint |
|---|---|
| Staging | `POST https://securestage.paytmpayments.com/vanproxy/api/v1/van?mid={MID}` |
| Production | `POST https://secure.paytmpayments.com/vanproxy/api/v1/van?mid={MID}` |

Every request **must** be wrapped in a `head` + `body` envelope. The checksum goes inside `head` as the field name **`token`** (NOT `signature`). See `references/REFERENCE.md` for the full head field table (`clientId`, `version`, `requestTimestamp`, `channelId`, `tokenType`, `token`).

---

## ❗ The quirks that keep biting

1. **`vanId` is 18 chars, not 16.** The first four chars are always `"PPSL"`. Never reconstruct it from `prefix + identificationNo` : always store the full 18-char `vanId` from the API response. Note: the vanproxy Create VAN response returns this as the field `van` (not `vanId`). Normalize on read: `vanEntry.van || vanEntry.vanId`.

2. **IFSC is always `UTIB0CCH274` and beneficiary is always `Paytm Payments Services Ltd.` : for every merchant, every customer.** Never show your own company name; the payer's bank will reject the transfer. Always display what the API returns : never hardcode.

3. **`requestId` is your idempotency key for Create VAN.** Replaying the same `requestId` returns the original response — including the original `vanId` — without creating a new VAN. Generate it on your side, store it, and replay on retry. Don't use a fresh UUID per retry or you'll duplicate VANs.

4. **TPV (Third-Party Validation) caps at 10 active accounts per VAN.** If you enable TPV (mandatory for BFSI per SEBI), Paytm rejects any payment from a bank account not in your registered list. You can't have an 11th — disable an old one first via `/van/update`. Non-TPV payments are bounced at source, not webhook-failed.

5. **Refunds need the remitter's bank details — and some banks don't send them.** When the inbound NEFT message lacks `remitterIFSC` / `remitterAccount`, the refund API will reject with `01000009: Remitter account info missing`. Surface this in your dashboard and handle the refund out-of-band (write back via cheque / manual transfer). Don't loop-retry — the data is gone.

6. **Refund max per request is ₹2L. For larger refunds, split.** A ₹5L refund needs three calls: ₹2L + ₹2L + ₹1L, each with its own unique `refundId`. The API does not auto-split.

7. **Settlement is T+1 only.** There is no same-day or instant settlement on this product, regardless of inbound rail (IMPS shows up in your webhook in seconds, but the money lands in your bank account next working day). Don't promise instant settlement to internal stakeholders.

8. **`vanDetails` absent + `resultStatus: S` = LPC not activated on this MID.** The `txnToken` is still valid and usable. Do not crash : log `"vanDetails missing : LPC not activated. Contact Paytm KAM."` and fall back to the Paytm JS Checkout modal. Bank Transfer will surface inside the modal once Paytm activates LPC on the MID.

9. **`identificationNo` is permanent per `merchantPrefix` in the Non-Checkout flow.** Once a VAN is created for a `(prefix, identificationNo)` pair, it cannot be recreated — calling Create again returns error **`4010` Already exists**. Query the existing VAN instead of retrying create. In the Checkout flow (order-based), the same `identificationNo` *can* be reused after `orderTimeout` expires.

10. **vanproxy response is two-level — check BOTH.** Outer `resultCode: "0000"` only means the API call was received. Each entry inside `vanDetails[]` has its own `responseStatus` (`SUCCESS` / `FAILURE`) with its own `errorCode` and `errorMessage`. Checking only the outer level silently treats per-VAN failures as successes.

11. **Non-Checkout flow: never wire the Create VAN button as a form submit.** If the button is `type="submit"` inside a `<form>` with any required fields, the browser silently swallows the click when validation fails — JavaScript never runs, nothing happens. Use `type="button"` with a direct click handler. Show validation errors and API status inline next to the button, not in a remote status panel.

---

## Minimum Create VAN body (Non-Checkout flow, merchant-managed) — vanproxy envelope

```json
{
  "head": {
    "clientId": "C11",
    "version": "v1",
    "requestTimestamp": "1700000000000",
    "channelId": "WEB",
    "tokenType": "CHECKSUM",
    "token": "<PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY)>"
  },
  "body": {
    "mid": "YOUR_MID",
    "requestId": "unique-key",
    "vanDetails": [
      {
        "merchantPrefix": "ABCD",
        "identificationNo": "1234567890",
        "purpose": "Book Purchase",
        "customerDetails": [
          {
            "customerName": "Acme Ltd",
            "customerMobile": "9876543210",
            "customerEmail": "acme@example.com"
          }
        ],
        "userDefinedFields": {},
        "tpvList": []
      }
    ]
  }
}
```

The `userDefinedFields` map is round-tripped on every webhook for that VAN — use it for whatever internal IDs you need to match against (the bank message will never carry your application's customer ID).

---

## Minimum webhook handler shape

```js
// POST /webhook/paytm/van
app.post("/webhook/paytm/van", express.json({ verify: keepRawBody }), (req, res) => {
  const body = req.body;
  const sig = body.signature;
  delete body.signature;

  if (!verifyHmac(body, sig, process.env.PAYTM_MERCHANT_KEY)) {
    return res.sendStatus(401);
  }

  if (body.eventType === "PAYMENT_SUCCESS" && body.status === "SUCCESS") {
    // amount is a string in paise-less rupees, e.g. "50000" = ₹50,000
    creditOrder({
      vanId: body.vanId,
      orderId: body.orderId,
      amount: body.amount,
      rail: body.transactionMode,            // NEFT | RTGS | IMPS | UPI
      remitter: {
        name: body.remitterName,
        account: body.remitterAccount,       // may be absent — see quirk #5
        ifsc: body.remitterIFSC
      },
      udf: body.udf
    });
  }

  // ALWAYS 200 within 5s, even on duplicates — Paytm retries on non-2xx
  res.sendStatus(200);
});
```

Webhook events: `PAYMENT_SUCCESS`, `PAYMENT_FAILURE` (mostly TPV rejections), `REFUND_SUCCESS`, `REFUND_FAILURE`.

**Non-Checkout flow UI updates — frontend must poll.** After displaying the VAN, there is no redirect or push to the frontend. Poll your server (e.g. `GET /api/van-payment-status?vanId=...`) every ~5 seconds to detect payment confirmation. The webhook is the source of truth server-side; the frontend polls a server endpoint that surfaces what the webhook recorded.

---

## Reconciliation pattern

Three sources of truth, in priority order:

1. **Webhook** (push, near-real-time, signed) — fulfil on this.
2. **`POST /van/orderList`** (pull, paginated by date range) — your nightly reconciliation job. Compare against your DB; mark any webhook-missed payments.
3. **`POST /van/transactionStatus`** (pull, single order) — for support tooling and idempotent replays.

Settle reconciliation (₹ in bank vs ₹ in webhooks) runs T+2 once Paytm's settlement report is published.

---

## Testing on Staging Environment

Before going live, validate your integration end-to-end on staging using Paytm's mock payment page. This simulates a real bank transfer without moving actual money.

> ⚠️ **Never use a real bank's NEFT/RTGS portal for staging testing.** The VAN contains alphanumeric characters (e.g. `PPSLALIS1234567890`) which many bank portals reject. Always use the mock page below.

---

### Step 1 : Set up your staging server
- `PAYTM_ENVIRONMENT=staging`
- `PAYTM_WEBSITE_NAME=WEBSTAGING`
- PG Domain: `https://securestage.paytmpayments.com`

---

### Step 2 : Place a test order on your website
1. Add items to cart and enter your identification number
2. Click **Pay** → Paytm JS Checkout modal opens
3. Select **Bank Transfer / NEFT / RTGS**
4. Note the **VAN (Account No.)**, **IFSC Code**, and **Amount** from the modal
5. Use the **copy icons** on the payment page to copy VAN and IFSC accurately : avoid typing manually

---

### Step 3 : Simulate the bank transfer

Open in a new browser tab:

```
https://securestage.paytmpayments.com/mockbank/largePaymentCollectionForm
```

| Field | Value |
|---|---|
| **Account Holder Name** | Any alphabetic name (e.g. `Test`) |
| **Bank Account No.** | `120000000000` |
| **Account IFSC Code** | Copy from payment page (Step 2) |
| **VAN Number** | Copy from payment page (Step 2) |
| **Transaction Amount** | Must match exact order amount |
| **Transaction Mode** | `NEFT`, `RTGS`, or `IMPS` |

Click **Submit**.

---

### Step 4 : Verify the result
- ✅ Mock page shows success response
- ✅ Your website updates to payment confirmed
- ✅ Server logs show `PAYMENT_SUCCESS` webhook received and signature verified

---

### Common staging mistakes to avoid
- ❌ Amount different from order amount → auto-refunded by Paytm
- ❌ Expired VAN → place a fresh order
- ❌ Wrong IFSC or VAN → always copy from the payment page
- ❌ Webhook URL is `localhost` → use ngrok or a public URL

---

## Testing Non-Checkout flow (permanent VAN) on Staging

1. **Create the VAN** — `POST https://securestage.paytmpayments.com/vanproxy/api/v1/van?mid={MID}` with the correct `head` + `body` envelope (see "Minimum Create VAN body" above).
2. **Extract** `vanId`, `ifscCode` (`UTIB0CCH274`), and `beneficiaryName` from `vanDetails[0]` in the response.
3. **Open the mock payment page** in a new tab: `https://securestage.paytmpayments.com/mockbank/largePaymentCollectionForm`.
4. **Fill the mock form:**

   | Field | Value |
   |---|---|
   | Account Holder Name | Any alphabetic name |
   | Bank Account No. | `120000000000` |
   | IFSC | `UTIB0CCH274` |
   | VAN Number | From step 2 |
   | Transaction Amount | Any |
   | Transaction Mode | `NEFT` / `RTGS` / `IMPS` |

5. **Verify** — your server should receive a signed `PAYMENT_SUCCESS` webhook. Check signature verification + server logs.

**Common Non-Checkout flow staging mistakes:**
- ❌ Using a real bank's NEFT portal → rejects alphanumeric VANs like `PPSLALIS1234567890`. Use only the mock page above.
- ❌ Wrong IFSC typed manually → always copy `UTIB0CCH274` exactly.
- ❌ Webhook URL is `localhost` → expose via ngrok or deploy to a public URL.

---

## Common error codes

| Code | Meaning | Fix |
|---|---|---|
| `01000100` | Success | — |
| `01000001` | Invalid request format | Check required fields per endpoint table in REFERENCE |
| `01000002` | Signature mismatch | Recompute HMAC over canonical JSON; check merchant key |
| `01000003` | VAN not found | `vanId` typo, or VAN belongs to a different MID |
| `01000004` | Merchant not activated for Large Payment Collection | Raise activation request from dashboard |
| `01000005` | Amount exceeds rail limit | Split or switch rail (RTGS for > ₹2L) |
| `01000006` | Order timeout expired (Checkout flow) | Recreate the order with a fresh VAN |
| `01000007` | TPV validation failed | Payer's bank account not in registered TPV list |
| `01000008` | Duplicate `requestId` | Idempotent replay — original response was returned |
| `01000009` | Remitter info missing — refund not possible | Handle refund out-of-band (see quirk #5) |
| `2001` | Bank Transfer mode not enabled on this MID | Bank Transfer (NEFT/RTGS/IMPS) is a separate activation switch from LPC itself. Contact Paytm integration team — no code fix. |
| `2002` | CheckSum Validation Failure | `head.token` field missing or named incorrectly (e.g. as `signature`), or any required head field absent (`clientId` / `version` / `requestTimestamp` / `channelId` / `tokenType`) | Fix the head envelope — see vanproxy request format in `references/REFERENCE.md` |
| `4010` | Already exists | `identificationNo` already has a VAN under this `merchantPrefix` (Non-Checkout flow only — permanent) | Query the existing VAN; use a different `identificationNo` for a new customer |

Full table, all flows, full request/response field reference: `references/REFERENCE.md`.
