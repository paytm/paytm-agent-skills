---
name: paytm-large-payment-collection
description: >
  Paytm Large Payment Collection (Bank Transfer) — accept high-ticket payments via NEFT / RTGS / IMPS
  (and Flow-2 UPI) using a unique 16-char Virtual Account Number (VAN) per customer / order. Paytm
  auto-reconciles the inbound bank transfer to the right VAN, fires a webhook with full remitter
  details, and settles T+1. Two flows: pre-created VANs for ongoing collections (BFSI, schools,
  distributors, subscriptions) and order-based VANs that expire after a configurable timeout. Covers
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

# Paytm Large Payment Collection (Bank Transfer)

Accept large-ticket payments via **NEFT / RTGS / IMPS** (and UPI in Flow 2) by handing each customer / order a unique **16-character Virtual Account Number (VAN)**. The customer pushes money from their bank → Paytm reconciles it to the VAN → you get a signed webhook with full remitter details → Paytm settles to your bank on **T+1**.

> Two files: `SKILL.md` (this) gives the endpoint family, VAN structure, and the highest-impact gotchas. `references/REFERENCE.md` has full per-endpoint field tables, TPV deep dive, error code table, and reconciliation patterns.
>
> **Do not generate any VAN / bank-transfer code until you have read `references/REFERENCE.md`.**

> **🟢 DEFAULT = Flow 2 (Order-based VAN via JS Checkout / `/initiateTransaction` + `vanInfo`).**
>
> When the user asks for "Large Payment Collection", "Paytm Bank Transfer", VAN, NEFT/RTGS collection, or anything in the trigger list, generate **Flow 2** code by default — i.e. call `POST /theia/api/v1/initiateTransaction` with a `vanInfo` block, get `txnToken`, and render the standard Paytm JS Checkout. Bank Transfer surfaces as a payment option **inside the Paytm checkout modal** alongside UPI / Credit Cards / Debit Cards / Net Banking / EMI; when the payer picks it, the modal shows them the generated VAN + IFSC + beneficiary + amount + countdown.
>
> Only fall back to Flow 1 (standalone `/van/create` server-only flow, no checkout modal) when the user explicitly asks for ongoing / multi-payment collections against a permanent VAN (e.g. school fees per student, distributor ledger, BFSI investor account with TPV).

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
| **Flow 1 — Pre-created VANs** | Ongoing collections (fees, distributors, subscriptions). One VAN per customer, no amount validation. Customer can pay any amount, any time. | Permanent (until you `DISABLE` it) |
| **Flow 2 — Order-based VANs** | One-shot orders with a known amount. Payment must match `txnAmount`; VAN expires after `orderTimeout`. Supports UPI in addition to NEFT/RTGS/IMPS. | Until `orderTimeout` expires |

**Default: Flow 2.** It plugs Bank Transfer into the standard JS Checkout modal, so the merchant gets one unified checkout surface (UPI / Credit Cards / Debit Cards / Net Banking / EMI **+ Bank Transfer**) for high-ticket orders. Use Flow 1 only when the merchant explicitly wants a permanent, server-only VAN per customer (school fees, distributor ledger, BFSI with TPV) and is NOT rendering a checkout modal at all.

---

## VAN structure — the 16-character format

```
1 1 [M E R C H A N T] [I D E N T I F I C A T I O N N O]
└─┬─┘ └─────┬───────┘ └────────────┬─────────────────┘
"11"   4 chars         10 chars
fixed  merchant prefix unique per customer / order
```

- **Position 1–2:** fixed `"11"` (Paytm bank identifier — never changes).
- **Position 3–6:** 4-char merchant prefix you choose at onboarding (e.g. `PYTM`, `IITK`, `ABCD`).
- **Position 7–16:** 10-char identification number. **Merchant-managed:** you supply it (student roll, invoice no, mobile). **Paytm-managed:** Paytm derives it from the customer's validated mobile.

**Fixed for every VAN you ever issue:**
- IFSC: `PYTM0123456`
- Beneficiary name: `One97 Communications Limited`

Display all three (`vanId`, IFSC, beneficiary) to the payer — banks reject NEFT/RTGS without all three.

---

## Endpoint family

| Operation | Endpoint |
|---|---|
| Create VAN (bulk, ≤ 10 per call) | `POST {BASE}/van/create` |
| Query VAN by `requestId` (idempotency) | `POST {BASE}/van/query` |
| Update VAN — DISABLE / add TPV bank accounts | `POST {BASE}/van/update` |
| List all VANs (paginated) | `POST {BASE}/van/list` |
| List inbound payments on a VAN (paginated) | `POST {BASE}/van/orderList` |
| Single transaction status by `orderId` | `POST {BASE}/van/transactionStatus` |
| Initiate refund (≤ ₹2L per request) | `POST {BASE}/van/refund` |
| Refund status | `POST {BASE}/van/refundStatus` |

All requests carry a `signature` (HMAC-SHA256 of the canonical JSON, keyed with your merchant key, base64-encoded). Responses are signed too — **verify before trusting**.

---

## ❗ The seven quirks that keep biting

1. **`vanId` is 16 chars, not 14, not 18.** The first two chars are always `"11"`. If you concatenate `prefix + identificationNo` and store *that*, you'll mismatch every webhook — the payload always uses the full 16-char `vanId`. Store `vanId` whole.

2. **IFSC is always `PYTM0123456` and beneficiary is always `One97 Communications Limited` — for every merchant, every customer.** Do not show your own company name on the bank-transfer instructions; the payer's bank will reject the NEFT/RTGS because the beneficiary name won't match what Paytm's bank has on file. Show the Paytm bank entity exactly.

3. **`requestId` is your idempotency key for Create VAN.** Replaying the same `requestId` returns the original response — including the original `vanId` — without creating a new VAN. Generate it on your side, store it, and replay on retry. Don't use a fresh UUID per retry or you'll duplicate VANs.

4. **TPV (Third-Party Validation) caps at 10 active accounts per VAN.** If you enable TPV (mandatory for BFSI per SEBI), Paytm rejects any payment from a bank account not in your registered list. You can't have an 11th — disable an old one first via `/van/update`. Non-TPV payments are bounced at source, not webhook-failed.

5. **Refunds need the remitter's bank details — and some banks don't send them.** When the inbound NEFT message lacks `remitterIFSC` / `remitterAccount`, the refund API will reject with `01000009: Remitter account info missing`. Surface this in your dashboard and handle the refund out-of-band (write back via cheque / manual transfer). Don't loop-retry — the data is gone.

6. **Refund max per request is ₹2L. For larger refunds, split.** A ₹5L refund needs three calls: ₹2L + ₹2L + ₹1L, each with its own unique `refundId`. The API does not auto-split.

7. **Settlement is T+1 only.** There is no same-day or instant settlement on this product, regardless of inbound rail (IMPS shows up in your webhook in seconds, but the money lands in your bank account next working day). Don't promise instant settlement to internal stakeholders.

---

## Minimum Create VAN body (Flow 1, merchant-managed)

```json
{
  "mid": "YOUR_MID",
  "requestId": "req_2024_01_15_inv12345",
  "van": [
    {
      "merchantPrefix": "PYTM",
      "identificationNo": "9876533333",
      "entityName": "Acme Distributors Pvt Ltd",
      "entityType": "BUSINESS",
      "customerId": "CUST_001",
      "invoiceNo": "INV_2024_001",
      "purpose": "Distributor Settlement",
      "udf": { "region": "north", "salesRep": "rk@acme" }
    }
  ],
  "signature": "<HMAC-SHA256 over canonical JSON>"
}
```

The `udf` map is round-tripped on every webhook for that VAN — use it for whatever internal IDs you need to match against (don't rely solely on `customerId`, which the bank message will never carry).

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

---

## Reconciliation pattern

Three sources of truth, in priority order:

1. **Webhook** (push, near-real-time, signed) — fulfil on this.
2. **`POST /van/orderList`** (pull, paginated by date range) — your nightly reconciliation job. Compare against your DB; mark any webhook-missed payments.
3. **`POST /van/transactionStatus`** (pull, single order) — for support tooling and idempotent replays.

Settle reconciliation (₹ in bank vs ₹ in webhooks) runs T+2 once Paytm's settlement report is published.

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
| `01000006` | Order timeout expired (Flow 2) | Recreate the order with a fresh VAN |
| `01000007` | TPV validation failed | Payer's bank account not in registered TPV list |
| `01000008` | Duplicate `requestId` | Idempotent replay — original response was returned |
| `01000009` | Remitter info missing — refund not possible | Handle refund out-of-band (see quirk #5) |

Full table, all flows, full request/response field reference: `references/REFERENCE.md`.
