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

| Environment | Base URL |
|---|---|
| Staging | `https://securegw-stage.paytm.in` |
| Production | `https://securegw.paytm.in` |

Always build and test against staging first. Production credentials are available after account activation on the Paytm dashboard.

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

**Request body:**
```json
{
  "head": { "signature": "<CHECKSUMHASH>" },
  "body": {
    "requestType": "Payment",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "ORDERID_98765",
    "callbackUrl": "https://yoursite.com/callback",
    "txnAmount": { "value": "1.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001" }
  }
}
```

**Response:** Returns `txnToken` — store this to invoke JS Checkout / SDK.

---

### Step 3 – Render Payment Page

**Web – JS Checkout:**
```html
<script src="https://securegw-stage.paytm.in/merchantpgpui/checkoutjs/merchants/{MID}.js"
        crossorigin="anonymous"></script>
<script>
  window.Paytm.CheckoutJS.init({
    merchant: { mid: "YOUR_MID", name: "Your Store" },
    order: { id: "ORDERID_98765", token: "<txnToken>", amount: "1.00" },
    flow: "DEFAULT",
    handler: {
      notifyMerchant: function(eventType, data) { console.log(eventType, data); }
    }
  }).then(() => window.Paytm.CheckoutJS.invoke());
</script>
```

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

## Reference Files

- `references/mobile-sdk.md` — All-in-One SDK and Custom UI SDK setup for Android, iOS, React Native, Flutter
- `references/web-integration.md` — JS Checkout and Non-SDK web integration details
- `references/affordability.md` — EMI, No Cost EMI, Bank Offers integration

---

## Docs Links

- Developer Home: `https://www.paytmpayments.com/docs/`
- Checksum Library: `https://www.paytmpayments.com/docs/checksum/`
- Server SDK: `https://www.paytmpayments.com/docs/server-sdk/`
- JS Checkout: `https://www.paytmpayments.com/docs/jscheckout/`
- All-in-One SDK: `https://www.paytmpayments.com/docs/all-in-one-sdk`
- API Reference: `https://www.paytmpayments.com/docs/api/initiate-transaction-api`
- Dashboard: `https://dashboard.paytmpayments.com`