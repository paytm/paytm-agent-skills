# Paytm Web Integration Reference

End-to-end JS Checkout flow + non-SDK form POST + payment links + subscriptions.
Working backends in three languages live under `scripts/backend-{node,spring,python}` and a copy-paste frontend at `scripts/frontend/js-checkout.html`.

---

## PG domains

Newer merchants are provisioned on `paytmpayments.com`; older MIDs may still be on `paytm.in`. Use whichever the dashboard shows for your MID.

| Environment | Newer (default) | Legacy |
|---|---|---|
| Production | `https://secure.paytmpayments.com` | `https://securegw.paytm.in` |
| Staging | `https://securestage.paytmpayments.com` | `https://securegw-stage.paytm.in` |

`pgDomain` is used for: `initiateTransaction` API, Transaction Status API, and the merchant CheckoutJS loader URL.

---

## JS Checkout — full flow

### 1. Server: `initiateTransaction` → `txnToken`

```
POST {pgDomain}/theia/api/v1/initiateTransaction?mid={MID}&orderId={ORDER_ID}
Content-Type: application/json
```

**Required body fields** (skipping any of these is the #1 cause of silent init failures):

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
    "userInfo": {
      "custId": "CUST_001",
      "mobile": "9999999999",
      "email": "buyer@example.com",
      "firstName": "Buyer",
      "lastName": "Name"
    }
  }
}
```

| Field | Notes |
|---|---|
| `mid` | Merchant ID from dashboard |
| `websiteName` | Per-MID; common values: `DEFAULT`, `WEBSTAGING`, `retail`. Must match dashboard exactly |
| `orderId` | `[A-Za-z0-9_@-]+`, ≤ 50 chars, **unique per attempt** (no reuse on retry) |
| `callbackUrl` | Where Paytm POSTs the user back; must be reachable from the user's browser |
| `txnAmount.value` | **String, two decimals**, e.g. `"1.00"` (not `1` or `1.0`) |
| `txnAmount.currency` | INR only for domestic PG |
| `userInfo.custId` | Required; your customer identifier |
| `userInfo.mobile` / `email` | Strongly recommended — pre-fills payment page, drives wallet OTP |

**Optional fields worth knowing:**

| Field | Use |
|---|---|
| `industryTypeId` | Provisioned per MID (e.g. `Retail`); rarely needed in body if dashboard default is correct |
| `channelId` | `WEB` (web) or `WAP` (mobile web). Most merchants leave it on dashboard default |
| `enablePaymentMode` / `disablePaymentMode` | Restrict allowed methods; array of `{ "mode": "UPI" \| "CC" \| "DC" \| "NB" \| "PAYTM_DIGITAL_CREDIT" \| "BALANCE", "channels": [...] }` |
| `goods` / `shippingInfo` | Required for some affordability/EMI flows |
| `extendInfo.mercUnqRef` | Echoed back in callbacks; useful for cross-system reconciliation |

**Response (success):**
```json
{
  "head": { "responseTimestamp": "...", "version": "v1", "signature": "..." },
  "body": {
    "resultInfo": { "resultStatus": "S", "resultCode": "0000", "resultMsg": "Success" },
    "txnToken": "abc123...",
    "isPromoCodeValid": false,
    "authenticated": false
  }
}
```

`txnToken` has a **15-minute TTL** and is **single-use** for invoking checkout.

### 2. Browser: load CheckoutJS for this MID

```html
<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
```

The loader URL **embeds your MID** — there is no shared script.

### 3. Browser: `init` → `invoke`

> **Browser-only.** This snippet touches `window.Paytm` and `document` — it cannot run in Next.js / Remix / RSC server components, in Node test scripts, or during SSR. Wrap in `"use client"` (Next.js), `onMount` (Svelte), or `typeof window !== "undefined"` guards.

```javascript
var config = {
  root: "",                 // CSS selector to mount inline; "" → modal popup
  flow: "DEFAULT",
  data: {
    orderId: "<orderId>",
    token: "<txnToken>",
    tokenType: "TXN_TOKEN",
    amount: "1.00"
  },
  merchant: { redirect: false },        // true = full-page redirect, false = popup
  handler: {
    notifyMerchant: function (eventName, data) {
      // SESSION_EXPIRED, APP_CLOSED, CHECK_ORDER_STATUS
      console.log("notifyMerchant", eventName, data);
    },
    transactionStatus: function (data) {
      // data.STATUS: TXN_SUCCESS / TXN_FAILURE / PENDING
      // ALWAYS reconfirm via Transaction Status API (server-side) before fulfilling
      window.Paytm.CheckoutJS.close();
    }
  }
};

window.Paytm.CheckoutJS.onLoad(function () {
  window.Paytm.CheckoutJS.init(config)
    .then(function () { window.Paytm.CheckoutJS.invoke(); })
    .catch(function (err) { console.error("init error", err); });
});
```

> **Note on shape:** Paytm docs show two slightly different config shapes. Modern merchants use the `data: { orderId, token, tokenType, amount }` form shown above (matches the working snippets in `scripts/`). Older docs show `merchant: { mid, name }` + `order: { id, token, amount }` — both work, but don't mix.

### 4. CheckoutJS events (`notifyMerchant`)

| Event | Trigger |
|---|---|
| `SESSION_EXPIRED` | `txnToken` past its 15-min TTL — request a new one |
| `APP_CLOSED` | User closed the popup before paying |
| `CHECK_ORDER_STATUS` | Paytm tells merchant to call Transaction Status API |
| `BANK_REDIRECT` | User redirected to bank/UPI app |

### 5. Callback (browser POST → your `callbackUrl`)

Paytm posts an `application/x-www-form-urlencoded` payload to the URL you supplied. Field names are **uppercase**:

| Field | Type | Notes |
|---|---|---|
| `MID` | string | Echoes your MID |
| `ORDERID` | string | Echoes your `orderId` |
| `TXNID` | string | Paytm-issued transaction id |
| `TXNAMOUNT` | string | `"1.00"` — verify against your stored amount |
| `PAYMENTMODE` | string | `UPI` / `CC` / `DC` / `NB` / `PPI` (wallet) |
| `CURRENCY` | string | `INR` |
| `TXNDATE` | string | `YYYY-MM-DD HH:MM:SS.s` IST |
| `STATUS` | string | `TXN_SUCCESS` / `TXN_FAILURE` / `PENDING` |
| `RESPCODE` | string | See `references/troubleshooting.md` |
| `RESPMSG` | string | Human-readable |
| `GATEWAYNAME` | string | Acquirer gateway |
| `BANKTXNID` | string | Bank-side reference |
| `BANKNAME` | string | Issuer / acquirer bank |
| `CHECKSUMHASH` | string | **Always verify before trusting** |

Verification differs from API checksum — pass the form params **minus `CHECKSUMHASH`** as a sorted map:

```python
PaytmChecksum.verifySignature(form_params_without_checksum, MERCHANT_KEY, checksumhash)
```

Implement **both `POST` and `GET`** on the callback URL — some browsers re-submit as GET when the user hits Back.

### 6. Server-to-server status verification (mandatory)

**The browser callback can be lost or tampered with.** Always reconfirm before fulfilling:

```
POST {pgDomain}/v3/order/status
{ "head": { "signature": "<sig>" }, "body": { "mid": "YOUR_MID", "orderId": "ORD_ABC123" } }
```

Compare `body.txnAmount` and `body.resultInfo.resultStatus` to your stored values.

---

## Callback vs S2S Webhook

| | Callback (browser) | Webhook (S2S) |
|---|---|---|
| Origin | User's browser | Paytm server |
| Reliability | Lossy (popup blockers, network drop, user closes tab) | Reliable, retried |
| Trust | Verify CHECKSUMHASH; treat as a *hint* | Verify CHECKSUMHASH; treat as authoritative for status changes |
| Setup | Pass `callbackUrl` in `initiateTransaction` | Configure on dashboard → Webhook Settings |
| Use for | UX (show success/failure page) | Order fulfillment, reconciliation |

**Recommended:** rely on webhook + Transaction Status API for fulfillment; use the callback only to render the post-payment UI.

---

## Non-SDK Web Integration (HTML form POST)

For environments where you cannot run JS:

```html
<form method="POST"
      action="{pgDomain}/theia/api/v1/showPaymentPage?mid={MID}&orderId={ORDER_ID}">
  <input type="hidden" name="mid" value="{MID}">
  <input type="hidden" name="orderId" value="{ORDER_ID}">
  <input type="hidden" name="txnToken" value="{TXN_TOKEN}">
</form>
<script>document.forms[0].submit();</script>
```

Paytm renders its full payment page and POSTs back to `callbackUrl`. Same callback verification rules apply.

---

## Payment Link API

```
POST {pgDomain}/link/create
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "amount": "100.00",
    "linkName": "Invoice-001",
    "linkType": "FIXED",
    "linkDescription": "Payment for order 001",
    "expiryDate": "30/12/2025 23:59:59",
    "sendSms": true,
    "sendEmail": false,
    "customerMobile": "9999999999",
    "customerEmail": "customer@example.com"
  }
}
```

Response → `longUrl` and `shortUrl` (e.g. `https://paytm.me/XXXXXXX`).

---

## Subscriptions (UPI Autopay) — Web

Pass these inside the standard `initiateTransaction` body:

```json
{
  "requestType": "SUBSCRIPTION",
  "subscriptionDetails": {
    "subscriptionId": "SUB_001",
    "subscriptionAmountType": "FIXED",
    "subscriptionFrequency": "MONTH",
    "subscriptionFrequencyUnit": "1",
    "subscriptionStartDate": "2025-01-01",
    "subscriptionEndDate": "2026-01-01",
    "subscriptionMaxAmount": "500.00"
  }
}
```

Subsequent debits are deducted automatically per the mandate. Docs: <https://www.paytmpayments.com/docs/subscription>.

---

## eCommerce Plugins (no-code)

| Platform | Where |
|---|---|
| WooCommerce | WordPress Plugin Repository → "Paytm Payment Gateway" |
| Magento 2 | <https://www.paytmpayments.com/docs/magento> |
| Shopify | Shopify App Store → "Paytm" |
| PrestaShop | <https://www.paytmpayments.com/docs/prestashop> |
| OpenCart | <https://www.paytmpayments.com/docs/opencart> |

All plugins require MID, Merchant Key, Industry Type, Website Name from the dashboard.

---

## Pitfalls (read before you ship)

1. **`websiteName` mismatch** usually fails `initiateTransaction` with `resultStatus: "F"`; in some legacy configs the API succeeds but JS Checkout then refuses to render. Check the dashboard value first.
2. **`txnAmount.value` must be a string** with exactly two decimals. `1`, `1.0`, `1.000` all fail checksum validation downstream.
3. **`orderId` is single-use** even on failure. Generate a fresh one for every retry.
4. **`txnToken` is single-use and 15-min TTL.** Don't cache or pre-fetch.
5. **Don't mix PG hosts.** A staging MID against a prod host returns confusing 401/checksum errors.
6. **Popup blockers** kill the modal flow. Always invoke from a user gesture; offer `redirect: true` as a fallback on mobile.
7. **Callback ≠ webhook.** Never fulfill from the browser callback alone — verify with Transaction Status API or wait for the S2S webhook.
8. **Field-name case** matters for callback verification: Paytm sends UPPERCASE keys; pass them through to `verifySignature` exactly as received.
9. **JSON serialization order**: hash and send the *same* string. Re-serializing between hash and POST breaks the signature.
10. **INR only.** Cross-border or multi-currency needs a different Paytm product.
