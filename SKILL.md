---
name: paytm-integration
description: >
  Expert guide for integrating Paytm Payment Gateway APIs and SDKs into websites, mobile apps, and backend systems.
  Use this skill whenever the user is working with Paytm payments — including setting up the payment gateway,
  generating checksums, calling Initiate Transaction / Transaction Status / Refund APIs, integrating the JS
  Checkout or All-in-One SDK, handling webhooks/callbacks, implementing UPI Autopay subscriptions, or
  troubleshooting Paytm PG errors. Trigger for any question containing "Paytm", "PG integration", "txnToken",
  "checksumhash", "MID", "merchant key", "securegw", or related payment gateway topics. Also trigger when the
  user is a Paytm merchant or payments developer asking about transaction flows, test credentials, or SDK setup,
  even if they don't say "Paytm" explicitly.
---

# Paytm Payment Gateway Integration Skill

## Overview

Paytm Payment Gateway supports UPI, Paytm Wallet, Credit/Debit Cards, Net Banking, and EMI.
Integration variants: **JS Checkout** (web), **All-in-One SDK** (mobile), **Custom UI SDK** (mobile),
**Server-to-Server APIs** (backend), and **eCommerce Plugins** (Magento, WooCommerce, Shopify, etc.).

---

## Key Concepts

| Concept | Description |
|---|---|
| **MID** | Merchant ID — unique identifier for your Paytm account |
| **Merchant Key** | Secret key used to generate/verify checksums |
| **txnToken** | Short-lived token returned by Initiate Transaction API; used in all subsequent steps |
| **CHECKSUMHASH** | HMAC-SHA256 signature generated with Merchant Key to authenticate API calls |
| **ORDER_ID** | Unique merchant-generated identifier per transaction |
| **callbackUrl** | URL where Paytm POSTs transaction result after payment |

---

## Environments

| Environment | Base URL (newer MIDs — default) | Legacy host |
|---|---|---|
| Staging | `https://securestage.paytmpayments.com` | `https://securegw-stage.paytm.in` |
| Production | `https://secure.paytmpayments.com` | `https://securegw.paytm.in` |

New merchants are provisioned on `paytmpayments.com`; older MIDs may still resolve only on `paytm.in`. Use whichever the dashboard shows for your MID — the two are not interchangeable per MID. Always build and test against staging first.

---

## Core Integration Flow

### Step 1 – Generate Checksum (Server-side)

Every API call requires a `CHECKSUMHASH` in the request header (as `signature`).

**Use Paytm's official checksum library** — available for Java, PHP, Python, Node.js, .NET, Go:
- Docs: `https://www.paytmpayments.com/docs/checksum/`
- GitHub: `https://github.com/Paytm-Payments`

```python
# Python example
from paytmchecksum import PaytmChecksum
checksum = PaytmChecksum.generateSignature(json.dumps(body), MERCHANT_KEY)
```

```java
// Java example
String checksum = PaytmChecksum.generateSignature(body.toString(), MERCHANT_KEY);
```

**Verify response checksum** (server-side, before trusting any payment response):
```python
is_valid = PaytmChecksum.verifySignature(response_body, MERCHANT_KEY, checksumhash)
```

---

### Step 2 – Initiate Transaction API

Called server-side to get a `txnToken` before rendering the payment UI.

**Endpoint:**
```
POST {BASE_URL}/theia/api/v1/initiateTransaction?mid={MID}&orderId={ORDER_ID}
```

**Request body** (all top-level body fields shown are required):
```json
{
  "head": { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" },
  "body": {
    "requestType": "Payment",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "ORD_ABC123",
    "callbackUrl": "https://yoursite.com/paytm/callback",
    "txnAmount": { "value": "1.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001", "mobile": "9999999999", "email": "buyer@example.com" }
  }
}
```

`websiteName` is per-MID (dashboard value, e.g. `DEFAULT`, `WEBSTAGING`, `retail`). `channelId` (`WEB`/`WAP`) and `industryTypeId` are usually inherited from the dashboard but can be overridden in the body. **Response:** `body.txnToken` — single-use, **15-min TTL**.

---

### Step 3 – Render Payment Page

**Web – JS Checkout** (browser-only — never paste into a Next.js / Remix / RSC server component; wrap in `"use client"` or guard with `typeof window !== "undefined"`):
```html
<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
<script>
  window.Paytm.CheckoutJS.onLoad(function () {
    window.Paytm.CheckoutJS.init({
      root: "",
      flow: "DEFAULT",
      data: {
        orderId: "ORD_ABC123",
        token: "<txnToken>",
        tokenType: "TXN_TOKEN",
        amount: "1.00"
      },
      merchant: { redirect: false },
      handler: {
        notifyMerchant: function (e, d) { console.log(e, d); },
        transactionStatus: function (d) { window.Paytm.CheckoutJS.close(); }
      }
    }).then(function () { window.Paytm.CheckoutJS.invoke(); });
  });
</script>
```
Full reference + alternative config shape in `references/web-integration.md`. Working copy-paste page at `scripts/frontend/js-checkout.html`.

**Mobile – All-in-One SDK:**
- Android: Add Paytm SDK to `build.gradle`, call `PaytmSDK.getBuilder()` with `txnToken`.
- iOS: Use `AIOCheckoutViewController` with `txnToken`.
- See `references/mobile-sdk.md` for detailed steps.

---

### Step 4 – Handle Callback

Paytm POSTs to your `callbackUrl` with:

```
ORDERID, MID, TXNID, TXNAMOUNT, PAYMENTMODE, STATUS, RESPCODE, RESPMSG, CHECKSUMHASH, ...
```

**Always verify `CHECKSUMHASH`** server-side before trusting the response.
**Never rely solely on callback** — confirm via Transaction Status API (step 5).

Key status values:
- `TXN_SUCCESS` — payment successful
- `TXN_FAILURE` — payment failed
- `PENDING` — awaiting bank confirmation

---

### Step 5 – Transaction Status API (mandatory verification)

```
POST {BASE_URL}/v3/order/status
```

```json
{
  "head": { "signature": "<CHECKSUMHASH>" },
  "body": { "mid": "YOUR_MID", "orderId": "ORDERID_98765" }
}
```

Treat this response as the **final authoritative status**. Call it server-to-server, not from the browser.

---

## Refunds

### Initiate Refund
```
POST {BASE_URL}/v2/refund/apply
```
```json
{
  "head": { "signature": "<CHECKSUMHASH>" },
  "body": {
    "mid": "YOUR_MID",
    "txnType": "REFUND",
    "orderId": "ORDERID_98765",
    "txnId": "PAYTM_TXN_ID",
    "refId": "UNIQUE_REFUND_REF_ID",
    "refundAmount": "1.00"
  }
}
```

### Refund Status
```
POST {BASE_URL}/v2/refund/status
```
```json
{
  "head": { "signature": "<CHECKSUMHASH>" },
  "body": { "mid": "YOUR_MID", "orderId": "ORDERID_98765", "refId": "UNIQUE_REFUND_REF_ID" }
}
```

---

## Server SDKs

Paytm provides server-side kits that wrap all major APIs + checksum generation:

| Language | Install |
|---|---|
| Java | Maven: `com.paytm.pg:merchant-sdk` |
| PHP | Composer: `paytm/pg-php-sdk` |
| Python | `pip install paytmchecksum` |
| Node.js | `npm install paytmchecksum` |
| .NET | NuGet: `Paytm.Checksum` |

SDK docs: `https://www.paytmpayments.com/docs/server-sdk/`

---

## UPI Autopay / Subscriptions

For recurring payments use Paytm's Subscription (UPI Autopay) product.
- Create a subscription mandate via Initiate Transaction with `requestType: "SUBSCRIPTION"`
- Subsequent charges are deducted automatically per mandate schedule
- Docs: `https://www.paytmpayments.com/docs/subscription`

---

## Common API Response Codes

| RESPCODE | Meaning |
|---|---|
| 01 | Success |
| 227 | Checksum mismatch |
| 330 | Invalid order ID |
| 334 | Duplicate order ID |
| 400 | Bad request / missing params |
| 501 | System error (retry) |

---

## Test Credentials (Staging)

- Paytm Wallet: Use test mobile number `7777777777`, OTP `489871`
- Cards: Use Paytm-provided test card numbers from the dashboard's **Test Data** section
- UPI: Any UPI ID ending in `@paytm` for staging

Dashboard: `https://dashboard.paytmpayments.com` → toggle **Test Data** mode

---

## Quick Reference: API Endpoints

| API | Endpoint |
|---|---|
| Initiate Transaction | `POST /theia/api/v1/initiateTransaction` |
| Fetch Payment Options | `POST /theia/api/v2/fetchPaymentOptions` |
| Process Transaction | `POST /theia/api/v1/processTransaction` |
| Transaction Status | `POST /v3/order/status` |
| Initiate Refund | `POST /v2/refund/apply` |
| Refund Status | `POST /v2/refund/status` |
| Create Subscription | `POST /subscription/create` |

All endpoints prefixed with the environment base URL.

---

## Pitfalls (read before shipping)

1. **`websiteName`** must match the dashboard exactly. Wrong value typically makes `initiateTransaction` itself fail with `body.resultInfo.resultStatus = "F"` and a generic message; in some legacy MID configs it returns a token that then fails at the JS Checkout step. Either way, check the dashboard value first.
2. **`txnAmount.value` is a string with two decimals** (`"1.00"`). `1`, `1.0`, `1.000` break things.
3. **`orderId` is single-use even on failure.** Generate a new one for every retry. Charset: `[A-Za-z0-9_@-]`, ≤ 50 chars.
4. **`txnToken`** is single-use, 15-minute TTL. Don't cache or pre-fetch.
5. **Don't mix PG hosts.** Staging MID + prod host (or vice versa) returns confusing 401/checksum errors.
6. **Browser callback ≠ webhook.** Callback can be lost (popup blockers, network drop). Always reconfirm via Transaction Status API or the S2S webhook before fulfilling.
7. **Callback verification** uses sorted form params *minus* `CHECKSUMHASH` — different shape from API checksum, and field names are UPPERCASE.
8. **JSON bytes used to sign must equal bytes sent.** Don't re-serialize between hashing and POSTing.
9. **INR only** for domestic Paytm PG.
10. Popup blockers kill the modal flow on mobile; offer `merchant.redirect: true` as a fallback.
11. **Callback URL must be reachable from the user's browser AND match what your backend listens on.** The reference backends default to `http://localhost:{3001|5001|8080/paytm-backend}` — when scaffolding a multi-service project (e.g. Next.js frontend on `:3000` + separate backend), set `PAYTM_CALLBACK_BASE` (or `PAYTM_CALLBACK_URL`) to the *backend's* public URL, not the frontend's. Never hard-code `localhost` for production.
12. **Frontend `fetch` calls are browser-only.** The reference HTML uses `new URL("paytm/create-order", document.baseURI)` which deliberately fails fast in SSR (no `document`). When using Next.js / RSC, isolate Paytm calls in client components or behind `typeof window` guards.

Symptom-driven debugging: `references/troubleshooting.md`.

---

## Reference Files

**Core flow**
- `references/web-integration.md` — JS Checkout, non-SDK form POST, full callback field list, callback-vs-webhook
- `references/mobile-sdk.md` — All-in-One SDK and Custom UI SDK setup for Android, iOS, React Native, Flutter
- `references/troubleshooting.md` — symptom → cause → fix tree, expanded RESPCODE table, decision tree

**Per-product deep dives**
- `references/refunds.md` — apply/status/webhook lifecycle, partial refunds, polling cadence, error codes
- `references/subscriptions.md` — UPI Autopay & card mandates, charge/edit/cancel, NPCI pre-notification rules
- `references/payment-links.md` — FIXED / REUSABLE / OPEN links, fetch, expire, SMS dispatch
- `references/tokenization.md` — RBI-compliant saved cards, network tokens, CVV-less mandates
- `references/webhooks.md` — S2S signature verification, retry/idempotency semantics, event reference
- `references/qr-codes.md` — dynamic & static QR generation, status, reconciliation
- `references/affordability.md` — Standard EMI, No-Cost EMI, Cardless EMI/BNPL, Bank Offers

**Reference backends + frontend**
- `scripts/backend-node/` — Express + `paytmchecksum`
- `scripts/backend-spring/` — Spring MVC + `RestTemplate`
- `scripts/backend-python/` — Flask + `paytmchecksum`
- `scripts/frontend/js-checkout.html` — minimal copy-paste browser page

---

## Docs Links

- Developer Home: `https://www.paytmpayments.com/docs/`
- Checksum Library: `https://www.paytmpayments.com/docs/checksum/`
- Server SDK: `https://www.paytmpayments.com/docs/server-sdk/`
- JS Checkout: `https://www.paytmpayments.com/docs/jscheckout/`
- All-in-One SDK: `https://www.paytmpayments.com/docs/all-in-one-sdk`
- API Reference: `https://www.paytmpayments.com/docs/api/initiate-transaction-api`
- Dashboard: `https://dashboard.paytmpayments.com`