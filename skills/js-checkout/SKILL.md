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

## Environments — pick the right base URL (critical)

There is **no `{BASE_URL}` placeholder you "figure out later"** — these are the only two valid Paytm PG domains. Hardcoding the wrong one is the single most common cause of 501 / 401 errors in this skill.

| Environment | `PAYTM_PG_DOMAIN` | When |
|---|---|---|
| **Staging / Test** | `https://securestage.paytmpayments.com` | MID starts with `PaytmT...` or any non-production key |
| **Production** | `https://secure.paytmpayments.com` | MID is a production-issued identifier (no `T` prefix; provisioned after KYC) |

**Do NOT use any of these — they are old / wrong domains that show up in stale tutorials and LLM training data:** `securegw.paytm.in`, `securegw-stage.paytm.in`, `pguat.paytm.com`. Paytm migrated off them years ago.

In code, derive once from `PAYTM_ENVIRONMENT`:

```js
const PAYTM_PG_DOMAIN =
  process.env.PAYTM_PG_DOMAIN ||
  (process.env.PAYTM_ENVIRONMENT === "production"
    ? "https://secure.paytmpayments.com"
    : "https://securestage.paytmpayments.com");
```

### `websiteName` per environment

`websiteName` is per-MID, set on the Paytm dashboard. Defaults you'll see in the wild:

| Environment | Common default | Other possibilities |
|---|---|---|
| Staging | `WEBSTAGING` | (almost always this — don't change unless dashboard says otherwise) |
| Production | `DEFAULT` | `retail`, `WEB`, or a custom value provisioned per merchant |

Wrong `websiteName` makes `initiateTransaction` succeed but the returned `txnToken` then fails when the JS Checkout tries to render. Check Developer Settings → API Keys → Test/Live API Details for the exact value.

### Reference backends (copy these — don't reinvent)

Working backends with the right env-var wiring, domain selection, and idempotency in `scripts/backend-{node,python,spring,spring-legacy}/`. Use one as your starting point:

| Language | Path | Key file |
|---|---|---|
| Node.js | `scripts/backend-node/` | `server.js`, `paytmService.js`, `paytmConfig.js` |
| Python | `scripts/backend-python/` | `app.py`, `paytm_service.py`, `paytm_config.py` |
| Spring Boot 3 | `scripts/backend-spring/` | `PaytmController.java`, `PaytmService.java` |
| Spring legacy (WAR) | `scripts/backend-spring-legacy/` | same files, `javax.servlet` instead of Jakarta |

The reference frontend at `scripts/frontend/checkout.html` shows the correct browser pattern — match it.

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

Server-side call to mint a `txnToken`. **Use the PG domain from the env table above** — do not hardcode an alternative.

```
POST {PAYTM_PG_DOMAIN}/theia/api/v1/initiateTransaction?mid={MID}&orderId={ORDER_ID}
```

Concrete examples:
```
# Staging:
POST https://securestage.paytmpayments.com/theia/api/v1/initiateTransaction?mid=PaytmTxxxxx&orderId=ORD_001

# Production:
POST https://secure.paytmpayments.com/theia/api/v1/initiateTransaction?mid=YOURMID&orderId=ORD_001
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

The merchant script URL is:

```
{PAYTM_PG_DOMAIN}/merchantpgpui/checkoutjs/merchants/{MID}.js
```

Two ways to load it. **Use the static loader unless you have a specific reason not to.**

### Recommended — static loader tag in HTML

Put a regular `<script src="...">` tag in your HTML. `window.Paytm` exists by the time your inline JS runs. Fewest failure modes.

```html
<!doctype html>
<html>
  <body>
    <button id="payBtn" disabled>Pay</button>

    <!-- Don't use crossorigin="anonymous" - Paytm's CDN doesn't always return
         CORS headers, and the browser will fire onerror silently. -->
    <script src="https://securestage.paytmpayments.com/merchantpgpui/checkoutjs/merchants/YOUR_MID.js"></script>

    <script>
      // window.Paytm is guaranteed to exist here because the <script> above
      // ran first. Safe to use Paytm.CheckoutJS.onLoad to enable the button.
      window.Paytm.CheckoutJS.onLoad(function () {
        document.getElementById("payBtn").disabled = false;
      });

      document.getElementById("payBtn").addEventListener("click", async () => {
        const res = await fetch("/paytm/create-order", { method: "POST" });
        const data = await res.json();
        const config = {
          root: "",
          flow: "DEFAULT",
          data: {
            orderId: data.orderId,
            token: data.txnToken,
            tokenType: "TXN_TOKEN",
            amount: data.amount,
          },
          merchant: { redirect: true },   // full-page redirect fallback
          handler: { /* see step 3.5 */ },
        };
        // Call init/invoke DIRECTLY in the click handler.
        // Do NOT wrap in another Paytm.CheckoutJS.onLoad() - that's the bug below.
        await window.Paytm.CheckoutJS.init(config);
        window.Paytm.CheckoutJS.invoke();
      });
    </script>
  </body>
</html>
```

### Alternative — dynamic loader (only when you must)

Use this only when your backend mints the loader URL at runtime (e.g. config endpoint that returns env-dependent values). It has three silent-failure traps; if you can avoid it, do.

```javascript
const cfg = await (await fetch("/paytm-client-config.json")).json();

const s = document.createElement("script");
s.src = cfg.loader_url;        // built from PAYTM_PG_DOMAIN + MID server-side

// (1) Do NOT set s.crossOrigin = "anonymous". Paytm CDN may not return CORS
//     headers; with crossOrigin set, the browser fires `onerror` silently
//     and your button stays disabled forever.

// (2) Wait for the script's native `load` event - NOT Paytm.CheckoutJS.onLoad.
//     The latter doesn't exist until the script you're trying to load has run.
s.onload = () => { document.getElementById("payBtn").disabled = false; };

// (3) ALWAYS handle onerror with user-visible feedback. Silent failure here is
//     the #1 "Pay button does nothing" support ticket.
s.onerror = (e) => {
  console.error("[paytm] loader failed", e);
  alert("Payment system failed to load. Please refresh.");
};

document.head.appendChild(s);
```

Click handler is the same as the static case — call `init` / `invoke` directly, never inside `Paytm.CheckoutJS.onLoad`.

### ❗ The bug: `CheckoutJS.onLoad()` inside a click handler

`Paytm.CheckoutJS.onLoad(cb)` fires **exactly once**, when the merchant `.js` finishes loading. By the time the user clicks Pay, it has already fired — your callback never runs and the modal silently never opens.

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

Use `Paytm.CheckoutJS.onLoad` **only** for one-time setup at page load (e.g. enabling the Pay button). In the click handler, call `init`/`invoke` directly.

### Init config — always use `redirect: true` unless you have a UX reason not to

```javascript
const config = {
  root: "",
  flow: "DEFAULT",
  data: {
    orderId: "ORD_ABC123",
    token: "<txnToken>",
    tokenType: "TXN_TOKEN",
    amount: "1.00"
  },
  merchant: { redirect: true },   // ✅ full-page redirect when modal can't open
  handler: { /* see step 3.5 below */ }
};
await window.Paytm.CheckoutJS.init(config);
window.Paytm.CheckoutJS.invoke();
```

`merchant: { redirect: false }` (modal-only) silently does **nothing** when the browser blocks the popup — common on mobile Safari, in iframes, and with strict ad blockers. Use `redirect: true` for the safe default; switch to `false` only if you've user-tested the modal in your specific UX.

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
