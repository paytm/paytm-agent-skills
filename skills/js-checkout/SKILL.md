---
name: paytm-js-checkout
description: >
  Complete JS Checkout (one-time payment) flow for Paytm Payment Gateway: Generate Checksum -> Initiate
  Transaction (txnToken) -> Render JS Checkout -> Handle Callback -> Transaction Status verification.
  Covers the merchant CheckoutJS script, init/invoke pattern, callback verification (`/v3/order/status`),
  and the most common bugs (`CheckoutJS.onLoad` trap, missing `transactionStatus`/`notifyMerchant`
  handlers, debug dumps on the user-facing screen). Load this skill for ALL one-time web payments
  (checkout pages, "Pay" buttons, in-app payments). Do NOT load for subscriptions, links, or QR.
triggers:
  - "txnToken"
  - "CHECKSUMHASH"
  - "/theia/api/v1/initiateTransaction"
  - "/v3/order/status"
  - "paytmchecksum"
  - "CheckoutJS"
  - "Paytm.CheckoutJS"
---

# Paytm JS Checkout (One-Time Payment)

Use this skill when the user wants a **checkout page with a "Pay" button** for one-time payments. For subscriptions, links, or QR, load the matching skill from `getting-started`.

Full callback field list, alternative non-SDK form-POST flow, every event the modal emits, and the corp-proxy TLS guidance: `references/REFERENCE.md`.

---

## Step 1 — Generate Checksum (server-side)

Every API call requires a `CHECKSUMHASH` in the request header (as `signature`).

Use Paytm's official checksum library — Java, PHP, Python, Node.js, .NET, Go.
Docs: <https://www.paytmpayments.com/docs/checksum/>

```python
from paytmchecksum import PaytmChecksum
checksum = PaytmChecksum.generateSignature(json.dumps(body), MERCHANT_KEY)
```

```java
String checksum = PaytmChecksum.generateSignature(body.toString(), MERCHANT_KEY);
```

**Verify response checksum** server-side before trusting any payment response:

```python
is_valid = PaytmChecksum.verifySignature(response_body, MERCHANT_KEY, checksumhash)
```

**Critical:** the bytes you sign MUST equal the bytes you POST. Don't re-serialize between hashing and sending — JSON property order or whitespace differences silently break the checksum.

---

## Step 2 — Initiate Transaction API

Server-side call to mint a `txnToken`.

```
POST {BASE_URL}/theia/api/v1/initiateTransaction?mid={MID}&orderId={ORDER_ID}
```

Body for one-time payment (all fields shown are required):

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

**Field rules:**
- `txnAmount.value` is a **string with two decimals** (`"1.00"`). `1`, `1.0`, `1.000` break.
- `orderId` charset `[A-Za-z0-9_@-]`, ≤ 50 chars. Single-use even on failure — generate a new one for every retry.
- `websiteName` is per-MID (dashboard value).
- `INR` only for domestic Paytm PG.

**Response:** `body.txnToken` — single-use, **15-minute TTL**. Don't cache.

---

## Step 3 — Render Payment Page (JS Checkout)

Browser-only — never paste into Next.js / Remix / RSC server components. Wrap in `"use client"` or guard with `typeof window !== "undefined"`.

```html
<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
```

### ❗ The most common bug: `CheckoutJS.onLoad()` inside a click handler

`CheckoutJS.onLoad(cb)` fires **exactly once**, when the merchant `.js` finishes loading. By click time it has already fired and your callback never runs. The modal silently fails to open.

**Broken (do not generate):**
```javascript
button.addEventListener("click", function () {
  fetch("/paytm/create-order", ...)
    .then(function (data) {
      window.Paytm.CheckoutJS.onLoad(function () {        // ❌ already fired
        window.Paytm.CheckoutJS.init(config).then(...);
      });
    });
});
```

There's a second trap: you can't call `window.Paytm.CheckoutJS.onLoad(...)` *anywhere* until the merchant `.js` script has loaded — it's what creates `window.Paytm`. If you load the script dynamically (after a `/paytm-client-config.json` fetch), `window.Paytm` is `undefined` at page-eval time.

**Correct — dynamic loader (matches `scripts/frontend/checkout.html`):**
```javascript
fetch("/paytm-client-config.json")
  .then(r => r.json())
  .then(cfg => {
    const s = document.createElement("script");
    s.src = cfg.loader_url;
    s.crossOrigin = "anonymous";
    s.onload = () => { payBtn.disabled = false; };       // ✅ native script onload
    document.head.appendChild(s);
  });

button.addEventListener("click", function () {
  fetch("/paytm/create-order", ...)
    .then(data => {
      const config = { /* ... */ };
      return window.Paytm.CheckoutJS.init(config).then(() => window.Paytm.CheckoutJS.invoke());
    });
});
```

**Alternative — static loader tag:** if you embed the merchant `.js` as a normal `<script src="...">` in HTML, then `window.Paytm` exists by the time inline JS runs and you *can* use `Paytm.CheckoutJS.onLoad(() => { payBtn.disabled = false; })` for the same purpose. Don't mix the two — pick one.

### Init config

```javascript
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
  handler: { /* see step 3.5 below */ }
}).then(function () { window.Paytm.CheckoutJS.invoke(); });
```

`merchant.redirect: true` falls back to a full-page redirect — useful when popup blockers kill the modal (common on mobile).

### Step 3.5 — wire BOTH handlers

**Symptom:** Payment completes (or fails, or is cancelled) and the page just sits there. User reloads, gets confused, may double-pay.

```javascript
handler: {
  notifyMerchant: function (eventName, data) {
    if (eventName === "APP_CLOSED")     setStatus("Payment cancelled.");
    if (eventName === "SESSION_EXPIRED") setStatus("Session expired. Retry.");
  },
  transactionStatus: function (data) {
    if (data.STATUS === "TXN_SUCCESS") setStatus("Payment successful.");
    else if (data.STATUS === "PENDING") setStatus("Payment pending - we'll confirm shortly.");
    else                                setStatus("Payment failed: " + data.RESPMSG);
    window.Paytm.CheckoutJS.close();
    // ALWAYS reconfirm server-side via /paytm/order-status before fulfilling.
  },
}
```

`transactionStatus` is the user-facing status. `notifyMerchant` covers lifecycle events (popup closed, session expired) where `transactionStatus` doesn't fire.

### Don't render debug dumps on the user-facing screen

Never add an on-screen logger / status panel / debug `<pre>` block / `JSON.stringify(data)` blob in production UI. Use `console.log` / `console.warn` for developer visibility. The user-facing UI shows only clean messages:

- "Payment successful"
- "Payment failed - please try again"
- "Payment cancelled"
- "Payment pending - we'll confirm shortly"

The reference `scripts/frontend/checkout.html` has a `#status` div for **demo purposes only** — drop it in real apps. No `alert()` either.

---

## Step 4 — Handle Callback

Paytm POSTs to your `callbackUrl` with form-encoded fields (UPPERCASE):

```
ORDERID, MID, TXNID, TXNAMOUNT, PAYMENTMODE, STATUS, RESPCODE, RESPMSG, CHECKSUMHASH, ...
```

**Always verify `CHECKSUMHASH` server-side** before trusting the response. Callback verification uses sorted form params *minus* `CHECKSUMHASH` — different shape from API checksum, field names UPPERCASE.

**Never rely solely on callback** — it can be lost (popup blockers, network drop, browser back button). Always reconfirm via the Transaction Status API (step 5) or the S2S webhook.

Key status values: `TXN_SUCCESS`, `TXN_FAILURE`, `PENDING`.

Full callback field list and the GET-vs-POST quirk in `references/REFERENCE.md`.

---

## Step 5 — Transaction Status API (mandatory verification)

```
POST {BASE_URL}/v3/order/status
Content-Type: application/json
```

```json
{
  "head": { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" },
  "body": { "mid": "YOUR_MID", "orderId": "ORDERID_98765" }
}
```

Treat this response as the **final authoritative status**. Server-to-server, never from the browser.

> **⚠️ `/v3/order/status` is for one-time-payment / JS-Checkout flows ONLY.** For Payment Link reconciliation use `/link/fetchTransaction` (see the `payment-links` skill). Different head shapes; mixing them causes checksum-mismatch errors that look unrelated.
>
> - **`/v3/order/status`** uses `head: { signature }` ONLY. Do NOT add `tokenType` (`"AES"`) or `timestamp`.
> - **`/link/*`** uses `head: { tokenType: "AES", signature, timestamp? }`.

---

## Server SDKs

| Language | Install |
|---|---|
| Java | Maven: `com.paytm.pg:merchant-sdk` |
| PHP | Composer: `paytm/pg-php-sdk` |
| Python | `pip install paytmchecksum` |
| Node.js | `npm install paytmchecksum` |
| .NET | NuGet: `Paytm.Checksum` |

SDK docs: <https://www.paytmpayments.com/docs/server-sdk/>

---

## Pre-ship checklist

1. `websiteName` matches dashboard exactly.
2. `txnAmount.value` is a string with two decimals.
3. `orderId` regenerated per attempt; charset valid.
4. Don't mix staging MID + prod host (or vice versa) — confusing 401/checksum errors.
5. JSON bytes used to sign equal bytes sent.
6. Callback handler verifies CHECKSUMHASH AND reconfirms via Transaction Status API.
7. `transactionStatus` AND `notifyMerchant` both wired.
8. Callback URL reachable from user's browser AND matches backend listener.
9. Frontend `fetch` calls are browser-only — guard SSR contexts.
10. Production code has no on-screen debug dump.

Symptom-driven debugging: load the `troubleshooting` skill.
