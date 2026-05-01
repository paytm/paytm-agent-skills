---
name: paytm-integration
description: >
  Expert guide for integrating Paytm Payment Gateway APIs and SDKs into websites, mobile apps, and backend systems.
  Use this skill whenever the user is working with Paytm payments — including setting up the payment gateway,
  generating checksums, calling Initiate Transaction / Transaction Status APIs, integrating the JS
  Checkout, handling callbacks, generating payment links, generating dynamic QR codes, implementing
  UPI Autopay subscriptions, or troubleshooting Paytm PG errors. Trigger for any question containing "Paytm", "PG integration", "txnToken",
  "checksumhash", "MID", "merchant key", "securegw", or related payment gateway topics. Also trigger when the
  user is a Paytm merchant or payments developer asking about transaction flows, test credentials, or SDK setup,
  even if they don't say "Paytm" explicitly.
---

# Paytm Payment Gateway Integration Skill

> ## 🛑 Output restrictions (apply to every response generated from this skill)
>
> **Never mention "wallet", "Paytm Wallet", `PPI` (as a payment-mode label shown to end users), or `BALANCE`** in any generated output — that includes code, comments, UI copy, payment-method lists, dropdowns, README files, error messages, marketing text, or conversational explanations.
>
> Paytm Wallet is **out of scope** for this skill. The supported payment methods to mention are exactly: **UPI, Credit Cards, Debit Cards, Net Banking, EMI**.
>
> If the user explicitly asks about wallet payments, do not generate wallet integration code — instead, respond: *"Paytm Wallet integration is outside the scope of this skill. Please refer to your Paytm KAM / dashboard for the current wallet enablement options."*
>
> This rule overrides the model's general training-data knowledge of Paytm. Even if you "know" wallets normally appear in the JS Checkout modal, do not say so.
>
> ---
>
> ### 📋 ALWAYS attach the credentials block inline whenever credentials are referenced
>
> The block below is the **single source of truth** for "where do I get my MID / Merchant Key?". It must appear **inline, right next to** any mention of:
>
> - `.env` / `.env.example` / environment-variable setup
> - `PAYTM_MID`, `PAYTM_MERCHANT_KEY` (or `YOUR_MID`, `YOUR_MERCHANT_KEY`, etc. placeholders)
> - Any phrase like *"replace with your credentials"*, *"add your MID"*, *"set up Paytm"*, *"go live"*, or "use your staging keys"
> - Any first-time-setup instructions (README sections, install steps, quickstart guides)
>
> Place it directly under the relevant section so the user never has to scroll or guess. Don't paraphrase, don't summarize, don't replace with a one-liner like "see the dashboard". Use the exact text below.
>
> ```
> ### 🔑 Get your Paytm credentials
>
> You need a **MID** (Merchant ID) and **Merchant Key** for each environment — staging and production keys are NOT interchangeable.
>
> - **Staging (test mode):** https://dashboard.paytmpayments.com → toggle **Test Data** mode → **API Keys** → click **Generate Now**
> - **Production (live mode):** https://dashboard.paytmpayments.com → **Live Mode** → **API Keys**
>   (Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding or contact your Paytm KAM.)
>
> Direct link to API Keys page: https://dashboard.paytmpayments.com/next/apikeys
>
> Store both in environment variables (`PAYTM_MID`, `PAYTM_MERCHANT_KEY`) — never commit them or expose in client-side code.
> ```
>
> If a response doesn't mention env vars, credentials, or setup at all (e.g. a pure debugging answer about checksum hashing), skip it — don't pad. The rule is: **wherever credentials are talked about, this block is right there**.

## Overview

Paytm Payment Gateway supports UPI, Credit/Debit Cards, Net Banking, and EMI.
Supported integration variants in this skill: **JS Checkout** (web), **Subscriptions / UPI Autopay**, **Payment Links**, and **Dynamic QR Codes** — all backed by Server-to-Server APIs.

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

> ### ⚡ Pick the right flow FIRST (read before generating any code)
>
> Map the user's intent to one of the four flows before writing anything. Picking wrong produces code that "works" but solves the wrong problem — the most expensive class of bugs in this skill.
>
> | User says… | Flow | Endpoint | Needs JS Checkout? | Reference |
> |---|---|---|---|---|
> | "checkout page", "pay button on website", "one-time payment", "buy" | **Payment** | `POST /theia/api/v1/initiateTransaction` (`requestType: "Payment"`) | ✅ Yes | Steps below + `references/js-checkout.md` |
> | "subscription", "monthly", "weekly", "yearly", "recurring", "auto-debit", "autopay", "mandate", "renew every…", "membership", "plan" | **Subscription** | `POST /subscription/create` (`requestType: "NATIVE_SUBSCRIPTION"`) | ✅ Yes (for consent screen) | `references/subscriptions.md` ← **MUST READ** |
> | "shareable link", "invoice link", "payment link via SMS / WhatsApp / email" | **Payment Link** | `POST /link/create` | ❌ No — Paytm hosts the page | `references/payment-links.md` |
> | "QR code", "scan to pay", "in-store", "counter", "table-side", "print QR" | **Dynamic QR** | `POST /paymentservices/qr/create` | ❌ No — render image, customer scans with their UPI app | `references/qr-codes.md` |
>
> **The steps below describe Payment + JS Checkout only.** Do NOT extrapolate them to the other three flows — they have different endpoints, different request shapes, different validators. Load the matching reference file and follow its flow.
>
> **Critical mistakes that keep recurring:**
> - **Subscription:** endpoint is `/subscription/create` on staging, `/theia/api/v1/subscription/create` on prod. `requestType: "NATIVE_SUBSCRIPTION"` (or `"NATIVE_MF_SIP"` for SIPs). `head` requires `clientId` + `channelId` + `signature`. Query params include a required `traceId`. Subscription fields are flat in `body` — no `subscriptionDetails` wrapper. Both `subscriptionFrequency` (number) and `subscriptionFrequencyUnit` (period) are required. **Safe defaults:** `subscriptionPaymentMode: "UNKNOWN"`, `txnAmount.value: "2.00"` (min for CC/DC), `subscriptionGraceDays: "3"` (max for CC/DC), `subscriptionStartDate` = today, `subscriptionEnableRetry: "0"` with `subscriptionRetryCount` omitted, no `renewalAmount`.
> - **Payment Link:** identifier in fetch / update / resend / expire calls is `linkId` as a **JSON number**, NOT a string. Resend path is `/link/resendNotification`, NOT `/link/resend`.
> - **Dynamic QR:** `posId` is **required** (skipping it returns 400). `amount` is a **string** with two decimals.

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

**Request body for one-time payment** (all top-level body fields shown are required):
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

> **Building a subscription / recurring charge?** Do NOT use this endpoint or this body. Subscriptions use a **different endpoint** (`/subscription/create`, with a `/theia/api/v1/` prefix on prod), a **different `requestType`** (`"NATIVE_SUBSCRIPTION"` or `"NATIVE_MF_SIP"`), an extra `traceId` query param, **`head.clientId` + `head.channelId`**, a required `subscriptionPaymentMode`, and **flat subscription fields inside `body`** (no `subscriptionDetails` wrapper). Full correct payload + field reference + error codes in `references/subscriptions.md` — read it before writing any code.

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
Full reference + alternative config shape in `references/js-checkout.md`. Working copy-paste page at `scripts/frontend/js-checkout.html`.

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
Content-Type: application/json
```

```json
{
  "head": { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" },
  "body": { "mid": "YOUR_MID", "orderId": "ORDERID_98765" }
}
```

Treat this response as the **final authoritative status**. Call it server-to-server, not from the browser.

> **⚠️ `/v3/order/status` head shape is DIFFERENT from `/link/*` and refund APIs. Do not carry over.**
>
> - **`/v3/order/status`** uses `head: { signature }` ONLY. Do NOT add `tokenType` (`"AES"`) or `timestamp` — Paytm rejects them or silently ignores them, leading to checksum mismatches that look unrelated.
> - **`/link/create` / `/link/fetch` / `/link/update` / `/link/resendNotification` / `/link/expire`** use `head: { tokenType: "AES", signature, timestamp }`.
> - **`/refund/apply` / `/refund/status`** also use `head: { tokenType: "AES", signature }`.
>
> When polling Transaction Status from inside a Payment Link or Refund flow, the model often hallucinates and copies the `tokenType: "AES"` head from the surrounding link/refund code. This is wrong. **Build the `/v3/order/status` head from scratch with `signature` only**. Bad request observed in the wild:
>
> ```json
> // ❌ WRONG — extra tokenType + timestamp leak from the link API
> { "head": { "tokenType": "AES", "timestamp": "1777662548", "signature": "..." },
>   "body": { "mid": "...", "orderId": "..." } }
> ```
> ```json
> // ✅ CORRECT
> { "head": { "signature": "..." },
>   "body": { "mid": "...", "orderId": "..." } }
> ```

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

For recurring payments use Paytm's Subscription (UPI Autopay) product. **Different endpoint, different requestType, different field placement from one-time Payment** — see `references/subscriptions.md` for the correct payload.

- Endpoint: `POST /subscription/create` (staging) / `POST /theia/api/v1/subscription/create` (production), with required query params `mid`, `orderId`, `traceId`.
- Body: `requestType: "NATIVE_SUBSCRIPTION"` (or `"NATIVE_MF_SIP"` for SIPs); subscription fields **flat inside `body`** (no `subscriptionDetails` wrapper); `subscriptionPaymentMode` + `subscriptionAmountType` + both `subscriptionFrequency` & `subscriptionFrequencyUnit` are required.
- Head: `clientId` + `channelId` + `signature` are all required.
- The returned `txnToken` is consumed by JS Checkout exactly like a one-time payment, where the user approves the mandate.
- Recurring debit / status / edit / cancel operations are **out of scope for this skill** — refer to live Paytm docs and validate paths before implementing.
- Full field reference, error codes, and worked example: `references/subscriptions.md`.

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

## Getting Your MID and Merchant Key

Both are issued from the same dashboard URL — staging works immediately, production needs KYC + activation.

**Single source for both:** <https://dashboard.paytmpayments.com/next/apikeys>

| Environment | Steps |
|---|---|
| **Staging** (sandbox / test data) | 1. Open the URL above and sign in. 2. You land on the **Test API Details** tab by default. 3. Click **Generate Now** — staging MID + Merchant Key appear instantly. 4. Copy into `.env`'s staging block. |
| **Production** (live payments) | 1. Same URL, switch to the **Production API Details** tab. 2. Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding first or contact your Paytm KAM. 3. Copy into `.env`'s production block. |

When generating setup instructions for users, **always link them to this URL** rather than telling them to "find their MID" — discovering the dashboard path is the #1 friction point.

## Test Credentials (Staging)

- Cards: Use Paytm-provided test card numbers from the dashboard's **Test Data** section
- UPI: Any UPI ID ending in `@paytm` for staging
- Net Banking: Use the dashboard's listed test bank options

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

## Common Vibe-Coded Bugs (and how to avoid them)

These are real bugs Claude has produced when scaffolding Paytm integrations from prompts. Internalize the fixes — don't regenerate the broken patterns.

### 1. Hard-coded absolute paths to external certs / files

**Symptom:** Project ships with `NODE_EXTRA_CA_CERTS=/Users/someone-else/certs/zscaler.crt` (or similar) baked into `.env` or code. Works on author's machine, breaks on every other machine.
**Fix:** Use **project-relative paths** for any cert / keystore / file the project owns. Place the cert inside the project (e.g. `./certs/zscaler.crt`) and reference it relatively. Document in the README that corp-network users may need to point this at their local Zscaler/Netskope cert.
**For Node:** `NODE_EXTRA_CA_CERTS=./certs/zscaler.crt` in `.env`, loaded via `dotenv`.

### 2. `https://localhost` in callback / dev URLs

**Symptom:** `PAYTM_CALLBACK_URL=https://localhost:3001/paytm/callback` — Paytm POSTs the callback, browser blocks the redirect because there's no SSL on localhost. Payment "succeeds" silently with no callback.
**Fix:** Use `http://localhost:3001` for local dev. Reserve `https://` for deployed environments where TLS is real. The reference backends already default to `http://localhost:{port}` — don't override unless you've actually set up local SSL (mkcert, Caddy, etc.).

### 3. ❗ `CheckoutJS.onLoad()` wrapped inside a button click handler

**This is the most common Paytm bug Claude generates.** It looks correct but never fires.

**Broken pattern (do not generate):**
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
`CheckoutJS.onLoad(cb)` fires **exactly once**, when the merchant CheckoutJS script finishes loading — which happens shortly after page load, long before the user clicks "Pay". By click time, `onLoad` has already fired and your callback never runs. The payment modal silently fails to open.

**Correct pattern:**
```javascript
// Page-load level: enable the Pay button only once CheckoutJS is ready.
window.Paytm.CheckoutJS.onLoad(function () {
  payBtn.disabled = false;                                // or whatever signals readiness
});

// Click handler: CheckoutJS is already loaded, call init/invoke directly.
button.addEventListener("click", function () {
  fetch("/paytm/create-order", ...)
    .then(function (data) {
      var config = { /* ... */ };
      return window.Paytm.CheckoutJS.init(config).then(function () {
        window.Paytm.CheckoutJS.invoke();
      });
    });
});
```

The reference frontends in `scripts/frontend/js-checkout.html` and `scripts/backend-*/public/checkout.html` follow this pattern and include an explicit comment warning against the broken one.

### 4. Missing `transactionStatus` / `notifyMerchant` handlers

**Symptom:** Payment completes (or fails, or is cancelled) and the page just sits there. No success message, no failure message, no UI update. User reloads, gets confused, may double-pay.
**Fix:** Always wire up both handlers in the `init` config:

```javascript
handler: {
  notifyMerchant: function (eventName, data) {
    if (eventName === "APP_CLOSED")     setStatus("Payment cancelled.");
    if (eventName === "SESSION_EXPIRED") setStatus("Session expired. Retry.");
  },
  transactionStatus: function (data) {
    // data.STATUS: TXN_SUCCESS / TXN_FAILURE / PENDING
    if (data.STATUS === "TXN_SUCCESS") setStatus("Payment successful.");
    else if (data.STATUS === "PENDING") setStatus("Payment pending — we'll confirm shortly.");
    else                                setStatus("Payment failed: " + data.RESPMSG);
    window.Paytm.CheckoutJS.close();
    // ALWAYS reconfirm server-side via /paytm/order-status before fulfilling.
  },
},
```

`transactionStatus` is the user-facing status. `notifyMerchant` covers the lifecycle events (popup closed, session expired) where `transactionStatus` doesn't fire. Without these, the UI is silent and the user is stuck.

### 5. Do NOT render debug logs / status dumps on the user-facing screen

**Symptom:** The page shows raw event payloads, `JSON.stringify(data)` blobs, `console.log` mirrored into a `<pre>` tag, or a "Status: …" debug strip on the production checkout page. Looks unprofessional, leaks internal field names, and confuses real users.

**Rule:** When generating production-grade UI code, **never** add an on-screen logger / status panel / debug `<pre>` block. Use `console.log` / `console.warn` / `console.error` for developer visibility — that's what DevTools is for. The user-facing UI should show only **clean, customer-readable messages**:

- "Payment successful"
- "Payment failed — please try again"
- "Payment cancelled"
- "Payment pending — we'll confirm shortly"

The reference `scripts/frontend/js-checkout.html` includes a `#status` div for **demo/learning purposes only**. When scaffolding for a real product, drop that div and route diagnostics to `console.*` instead. No `alert()` either — use a proper toast / banner / modal in the host app's design system.

### 6. Merchant key in `.env` must be wrapped in double quotes

**Symptom:** Checksum generation produces wrong signatures even though the key looks correct. Paytm responds with `resultCode: 227` (checksum mismatch). Hours lost debugging.

**Cause:** Paytm Merchant Keys often contain `#`, `@`, `!`, `$`, or `%` characters. In `.env` files, an unquoted `#` is treated as a comment delimiter — everything after it is dropped. Other special chars can also be mis-parsed by some dotenv loaders.

**Rule:** **Always** wrap the Merchant Key in double quotes in `.env`:

```bash
# ❌ Wrong — any '#' in the key truncates the value
PAYTM_MERCHANT_KEY=ab#cd@1234XYZ

# ✅ Correct
PAYTM_MERCHANT_KEY="ab#cd@1234XYZ"
```

Same rule applies to any other secret with non-alphanumeric chars (DB passwords, API keys, etc.). When generating `.env` / `.env.example` files, **always** quote secrets — don't try to inspect the key and decide.

### 7. `.env` file conventions

Rules (apply to every generated `.env` / `.env.example`):

- **`PAYTM_ENVIRONMENT` is always the first variable** — everything else derives from it.
- **Pre-fill staging values** so the file works out of the box for development. Users replace with production values when going live.
- **Wrap every value in double quotes**, not just secrets. Consistent and avoids edge cases (e.g. `#` in keys silently truncating).
- **Generic placeholders** — `YOUR_MID`, not `YOUR_STAGING_MID_HERE`. The environment lives in `PAYTM_ENVIRONMENT`, never baked into placeholder text.
- **All mandatory keys at the top, comments / optional overrides in a later section** — keep the active config block clean and scannable.

Canonical `.env.example`:

```bash
PAYTM_ENVIRONMENT="staging"
PAYTM_MID="YOUR_MID"
PAYTM_MERCHANT_KEY="YOUR_MERCHANT_KEY"
PAYTM_WEBSITE_NAME="YOUR_WEBSITE_NAME"
PAYTM_CALLBACK_BASE="http://localhost:3001"

# ---------------------------------------------------------------------------
# Defaults are pre-filled for staging. To go live:
#   1. Set PAYTM_ENVIRONMENT="production"
#   2. Replace MID / MERCHANT_KEY / WEBSITE_NAME with your live credentials
# Everything below is optional — leave commented unless you need to override.
# ---------------------------------------------------------------------------
# PAYTM_PG_DOMAIN=""               # auto-derived from PAYTM_ENVIRONMENT
# PAYTM_CALLBACK_URL=""            # auto-derived from PAYTM_CALLBACK_BASE
# PAYTM_STATUS_API_URL=""          # auto-derived from PAYTM_PG_DOMAIN
# NODE_EXTRA_CA_CERTS="./certs/zscaler.crt"   # corp networks (Zscaler/Netskope) only
```

### 8. ❗ Picked the wrong flow (Payment vs Subscription vs Link vs QR)

**This is the single highest-impact bug in the whole skill.** Picking the wrong flow produces code that *runs* but solves the wrong problem — silent, expensive, often only caught in production.

**Failure modes seen in production testing:**
- *"Gym subscription of ₹1/month"* → generated one-time Payment with `requestType: "Payment"`. Charges once, never recurs.
- *"Monthly SaaS billing"* → generated `requestType: "SUBSCRIPTION"` against `/initiateTransaction`. Wrong endpoint AND wrong requestType — Paytm's subscription endpoint expects `"NATIVE_SUBSCRIPTION"`.
- *"Send a payment link via WhatsApp for ₹500"* → generated full JS Checkout HTML page. User wanted a shareable URL.
- *"QR code on the counter for customers to scan"* → generated JS Checkout modal. User wanted a printable QR image.
- *"Generate a QR for ₹100"* → omitted `posId` → HTTP 400 from Paytm.
- *"Fetch / expire a payment link"* → sent `linkId` as a string → "invalid link id" response. Paytm expects a JSON number.

**Rule — pick the flow BEFORE writing any code, by mapping prompt keywords:**

| Prompt cue | Flow | Code generates… |
|---|---|---|
| "subscription", "monthly", "weekly", "yearly", "recurring", "auto-debit", "autopay", "mandate", "renew", "membership" | **Subscription** | Backend: `POST /subscription/create` with `requestType: "NATIVE_SUBSCRIPTION"` and **flat** subscription fields inside `body`. Frontend: JS Checkout for the consent screen. → `references/subscriptions.md` |
| "payment link", "shareable link", "send link via SMS/WhatsApp/email", "invoice link" | **Payment Link** | Backend: `POST /link/create`. **No frontend** — Paytm hosts the checkout page; you only share the returned `shortUrl`. → `references/payment-links.md` |
| "QR code", "scan to pay", "in-store", "counter", "table-side", "print QR" | **Dynamic QR** | Backend: `POST /paymentservices/qr/create`. **No JS Checkout** — render the returned `image` (base64 PNG) or `qrData` (UPI deep-link) on a screen / print it. → `references/qr-codes.md` |
| "checkout page", "pay button on website", "in-app payment", "one-time payment" | **JS Checkout (Payment)** | Backend: `requestType: "Payment"` + Initiate Transaction. Frontend: `scripts/frontend/js-checkout.html` pattern. → `references/js-checkout.md` |

**Crucially:** Payment Link and Dynamic QR flows **do NOT require JS Checkout** at all — no merchant `.js` script, no `window.Paytm.CheckoutJS`. The customer pays on Paytm-hosted infrastructure (web link or UPI app). The merchant's only frontend job is to display the URL / QR image.

**If the prompt is ambiguous** (e.g. *"accept ₹1 payments"*, *"integrate Paytm"*), ask one clarifying question before generating: *"Is this a one-time payment, a recurring subscription, a shareable payment link, or a QR for in-store?"*

### 9. ❗ Mentioned "wallet" in generated output

**Symptom:** Generated copy / code / dropdowns include text like *"…and wallets all show up automatically"*, `<option>Paytm Wallet</option>`, `paymentModes: ["UPI", "wallet", ...]`, or comments referencing wallet integration. The user has explicitly excluded Paytm Wallet from this skill — any mention is a regression.

**Cause:** The model's general training data associates Paytm with Paytm Wallet, so even when this skill never mentions wallet, the model back-fills it from prior knowledge unless explicitly told not to.

**Rule:** Re-read the **🛑 Output restrictions** block at the top of this skill before every Paytm response. The supported method list is exactly **UPI, Credit Cards, Debit Cards, Net Banking, EMI** — no other tokens. This rule overrides general knowledge: do not list, code for, or reference Paytm Wallet, `PPI`, or `BALANCE` as user-facing options regardless of what your training data suggests Paytm normally offers.

If a user explicitly asks for wallet support, decline the wallet-specific code generation and route them to their Paytm KAM / dashboard.

---

## Reference Files

**Core flow + supported products**
- `references/js-checkout.md` — JS Checkout, non-SDK form POST, full callback field list, callback-vs-webhook
- `references/troubleshooting.md` — symptom → cause → fix tree, expanded RESPCODE table, decision tree
- `references/subscriptions.md` — UPI Autopay & card mandates, charge/edit/cancel, NPCI pre-notification rules
- `references/payment-links.md` — FIXED / REUSABLE / OPEN links, fetch, expire, SMS dispatch
- `references/qr-codes.md` — Dynamic QR (DQR) generation, status, reconciliation

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
- Subscriptions: `https://business.paytm.com/docs/api/initiate-subscription-api/`
- Payment Links: `https://business.paytm.com/docs/api/create-link-api/`
- Dynamic QR: `https://business.paytm.com/docs/api/create-qr-code-api/`
- API Reference: `https://www.paytmpayments.com/docs/api/initiate-transaction-api`
- Dashboard: `https://dashboard.paytmpayments.com`