# Paytm Subscriptions / UPI Autopay (Native Create Subscription)

Recurring debits with one user-consented mandate. Supported rails: **UPI Autopay** (NPCI), **Cards** (RBI e-mandate), **Net Banking** (limited issuers).

> **⚠️ READ THIS FIRST — common mistakes that break subscription integrations:**
>
> 1. **Endpoints differ between staging and production:**
>    - Staging: `POST https://securestage.paytmpayments.com/subscription/create`
>    - Production: `POST https://secure.paytmpayments.com/theia/api/v1/subscription/create`
>    Production has the extra `/theia/api/v1/` prefix. Most teams set this once via `PAYTM_PG_DOMAIN` and forget — double-check on first prod deploy.
> 2. **Three query params are required:** `mid`, `orderId`, **and `traceId`**. `traceId` is alphanumeric + hyphens / underscores only.
> 3. **`head` requires `clientId` (e.g. `"C11"`) and `channelId` (`"WEB"` / `"WAP"`)** in addition to `signature`. Missing either → request rejected before it reaches business logic.
> 4. **`requestType`** is **`"NATIVE_SUBSCRIPTION"`** for standard subscriptions, **`"NATIVE_MF_SIP"`** for mutual-fund SIPs. Not `"SUBSCRIPTION"`, not `"Payment"`.
> 5. Subscription fields are **flat inside `body`** — DO NOT wrap them in a `subscriptionDetails` / `subscriptionInfo` object. Wrapping returns HTTP 400.
> 6. **Both `subscriptionFrequency` AND `subscriptionFrequencyUnit` are required.** Frequency is the number ("2"), unit is the period ("MONTH"). Together: every 2 months. Earlier versions of this skill said "no subscriptionFrequency field" — that was wrong.
> 7. **`subscriptionPaymentMode` is required** — one of `"CC"` / `"DC"` / `"PPI"` / `"BANK_MANDATE"`.
> 8. `subscriptionEnableRetry` is a **string** `"1"` / `"0"`, not a boolean.
> 9. **`autoRenewal` / `autoRetry` / `communicationManager` ARE booleans** (true/false). Inconsistent with `subscriptionEnableRetry`, but that's how the API is.
> 10. Dates (`subscriptionStartDate`, `subscriptionExpiryDate`) are `YYYY-MM-DD`.
> 11. `subscriptionStartDate` and `subscriptionGraceDays` are **conditionally paired** — if you send one, send both.
> 12. **`userInfo.custId` must be sanitized** — alphanumerics + `_` `@` `!` `$` `.` are accepted; spaces, special characters, and unicode otherwise are rejected with `"Invalid Customer ID"`. Safest: `custId.replace(/[^a-zA-Z0-9_]/g, "_")`.
> 13. **"No payment options available" on the consent screen** = subscription product is not enabled on the MID. Ask Paytm support / KAM to enable Subscription / UPI Autopay; the API will let you generate `txnToken` even when the product isn't entitled, so it surfaces only at JS Checkout time.

---

## Scope of this skill

This skill covers **only** the mandate-creation flow:
1. Server calls `/subscription/create` to get a `txnToken` + `subscriptionId`.
2. Browser invokes JS Checkout with that `txnToken` so the user can complete the mandate consent.

Subsequent operations (status check, recurring debit, edit, cancel) are intentionally **out of scope**. Refer to live Paytm docs and validate paths before implementing those.

---

## Concepts

| Term | Meaning |
|---|---|
| **Mandate** | One-time user authorization at a maximum amount, frequency, and validity window |
| **Subscription ID** | Paytm-issued ID for the mandate, returned in the create response |
| **Mandate state** | `INITIATED` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `REJECTED` |
| **traceId** | Per-request unique id for tracing on Paytm's side. Generate one per call (UUID-like) |
| **clientId** | Paytm-issued identifier for the merchant key (`"C11"` for single-key merchants) |
| **Pre-notification** | NPCI rule: notify user 24h before debit on UPI Autopay (Paytm handles this) |

---

## Step 1 — Create the mandate (server-side)

### Endpoint

| Environment | Full URL |
|---|---|
| Staging | `POST https://securestage.paytmpayments.com/subscription/create?mid={MID}&orderId={ORDER_ID}&traceId={TRACE_ID}` |
| Production | `POST https://secure.paytmpayments.com/theia/api/v1/subscription/create?mid={MID}&orderId={ORDER_ID}&traceId={TRACE_ID}` |

`Content-Type: application/json`

### Request

```json
{
  "head": {
    "clientId": "C11",
    "channelId": "WEB",
    "version": "v1",
    "requestTimestamp": "1714464000000",
    "signature": "<CHECKSUMHASH over JSON.stringify(body)>"
  },
  "body": {
    "requestType": "NATIVE_SUBSCRIPTION",
    "mid": "YOUR_MID",
    "orderId": "SUB_ORD_001",
    "websiteName": "WEBSTAGING",
    "txnAmount": { "value": "1.00", "currency": "INR" },

    "subscriptionPaymentMode": "BANK_MANDATE",
    "subscriptionAmountType": "FIX",
    "subscriptionMaxAmount": "499.00",
    "subscriptionFrequency": "1",
    "subscriptionFrequencyUnit": "MONTH",
    "subscriptionStartDate": "2026-05-01",
    "subscriptionExpiryDate": "2027-05-01",
    "subscriptionGraceDays": "5",
    "subscriptionEnableRetry": "1",
    "subscriptionRetryCount": "3",
    "mandateType": "E_MANDATE",

    "userInfo": {
      "custId": "CUST_001",
      "mobile": "9999999999",
      "email": "buyer@example.com",
      "firstName": "Buyer",
      "lastName": "Name"
    },

    "callbackUrl": "https://yoursite.com/paytm/callback",
    "extendInfo": { "mercUnqRef": "INVOICE-INV-001" }
  }
}
```

### Field reference

**`head`**

| Field | Required | Notes |
|---|---|---|
| `clientId` | ✅ | `"C11"` for single-merchant-key setups; provided by Paytm during onboarding |
| `channelId` | ✅ | `"WEB"` (web server) or `"WAP"` (mobile) |
| `signature` | ✅ | CHECKSUMHASH over `JSON.stringify(body)` |
| `version` | optional | `"v1"` |
| `requestTimestamp` | optional | UNIX epoch in **milliseconds** as a string |

**`body` — core**

| Field | Required | Notes |
|---|---|---|
| `requestType` | ✅ | `"NATIVE_SUBSCRIPTION"` (standard) or `"NATIVE_MF_SIP"` (mutual-fund SIPs) |
| `mid` | ✅ | Same value as the `mid` query param |
| `orderId` | ✅ | Same value as the `orderId` query param |
| `websiteName` | ✅ | `"WEBSTAGING"` for staging; per-MID for prod (e.g. `"DEFAULT"`, `"retail"`) |
| `txnAmount.value` | ✅ | First-debit amount as **string** with two decimals (`"1.00"`) |
| `txnAmount.currency` | ✅ | `"INR"` |
| `userInfo.custId` | ✅ | Sanitize first — see callout above. Allowed extras: `@ ! _ $ .` |
| `userInfo.mobile` / `email` / `firstName` / `lastName` | optional | Strongly recommended — pre-fills consent screen |

**`body` — subscription**

| Field | Required | Notes |
|---|---|---|
| `subscriptionPaymentMode` | ✅ | `"CC"` / `"DC"` / `"PPI"` / `"BANK_MANDATE"`. For UPI Autopay use `"BANK_MANDATE"` with `mandateType: "E_MANDATE"` |
| `subscriptionAmountType` | ✅ | `"FIX"` (same amount each cycle) or `"VARIABLE"` (variable, ≤ `subscriptionMaxAmount`) |
| `subscriptionMaxAmount` | conditional | **Required** when `subscriptionAmountType: "VARIABLE"`. For FIX, set to the per-cycle amount |
| `subscriptionFrequency` | ✅ | The **number** of `Unit`s per cycle, as string. `"1"` + unit `MONTH` = monthly; `"15"` + `DAY` = every 15 days |
| `subscriptionFrequencyUnit` | ✅ | Per Paytm doc: daily / weekly / monthly / yearly. Examples seen: `"DAY"`, `"WEEK"`, `"MONTH"`, `"YEAR"`, `"ONDEMAND"`. Confirm with your Paytm KAM if unsure |
| `subscriptionStartDate` | conditional | `YYYY-MM-DD` IST. Required if `subscriptionGraceDays` is set. Cannot be in the past |
| `subscriptionGraceDays` | conditional | String. Days after the renewal-cycle start during which Paytm may still attempt the debit. Required if `subscriptionStartDate` is set |
| `subscriptionExpiryDate` | ✅ | `YYYY-MM-DD` IST |
| `subscriptionEnableRetry` | ✅ | **String** `"1"` (enable) / `"0"` (disable) |
| `subscriptionRetryCount` | optional | String, number of retries on failure |
| `mandateType` | conditional | `"E_MANDATE"` or `"PAPER_MANDATE"` — required when `subscriptionPaymentMode: "BANK_MANDATE"` |
| `autoRenewal` | optional | **Boolean** (true/false) |
| `autoRetry` | optional | **Boolean** (true/false) |
| `communicationManager` | optional | **Boolean** (true/false). Enables Paytm-side notifications |
| `subsGoodsInfo` | conditional | Required when `communicationManager: true` |
| `renewalAmount` | optional | Recurring amount surfaced to the user / used for auto-renewal |
| `subscriptionPurpose` | optional | Free text, e.g. `"Loan Payments"` |
| `enablePaymentMode` / `disablePaymentMode` | optional | Arrays of `{ "mode": "CREDIT_CARD" \| ... }` to restrict / exclude payment instruments |
| `mandateAccountDetails` | optional | Bank mandate account details (advanced) |
| `callbackUrl` | optional | Where Paytm redirects the user after consent |
| `extendInfo.udf1` / `udf2` / `udf3` | optional | Free-form merchant fields |
| `extendInfo.mercUnqRef` | optional | Echoed in the UMP dashboard for filtering |
| `extendInfo.comments` | optional | Free-form |

### Response

```json
{
  "head": {
    "responseTimestamp": "1714464000000",
    "version": "v1",
    "clientId": "C11",
    "signature": "..."
  },
  "body": {
    "resultInfo": {
      "resultStatus": "S",
      "resultCode": "0000",
      "resultMsg": "SUCCESS"
    },
    "txnToken": "abc123...",
    "subscriptionId": "<paytm subscriptionId>",
    "authenticated": "False",
    "isPromoCodeValid": false
  }
}
```

| Field | Notes |
|---|---|
| `resultInfo.resultStatus` | `"S"` = success, `"F"` = failure |
| `resultInfo.resultCode` | 4-character code; see error table below |
| `txnToken` | Single-use, **15-min TTL** — pass to JS Checkout in Step 2 |
| `subscriptionId` | Persist this; it identifies the mandate for any future operations |
| `authenticated` | String `"True"` / `"False"` (note: string, not boolean) |

### Sanitize `userInfo.custId` before sending

Paytm rejects custIds with characters outside `[A-Za-z0-9_@!$.]` with `"Invalid Customer ID"`. Safest path is to normalize to `[A-Za-z0-9_]` only:

```javascript
// Node
const safeCustId = (rawCustId || "CUST_DEMO").replace(/[^a-zA-Z0-9_]/g, "_");
```

```python
# Python
import re
safe_cust_id = re.sub(r"[^a-zA-Z0-9_]", "_", raw_cust_id or "CUST_DEMO")
```

```java
// Java
String safeCustId = (rawCustId == null ? "CUST_DEMO" : rawCustId).replaceAll("[^a-zA-Z0-9_]", "_");
```

`"Rahul Sharma"` → `"Rahul_Sharma"`. Persist the sanitized form so future calls stay consistent.

---

## Step 2 — Invoke JS Checkout for consent

Same JS Checkout flow as a one-time payment — only the `txnToken` source differs (it came from `/subscription/create`):

```html
<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
<script>
  window.Paytm.CheckoutJS.onLoad(function () {
    window.Paytm.CheckoutJS.init({
      root: "",
      flow: "DEFAULT",
      data: {
        orderId: "SUB_ORD_001",
        token: "<txnToken from /subscription/create>",
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

The user sees the consent screen showing the recurring amount + frequency, approves the mandate, then Paytm POSTs to your `callbackUrl` with the standard fields plus `subscriptionId`. **Verify `CHECKSUMHASH` on the callback** before treating the mandate as set up. Full callback details in `references/js-checkout.md`.

---

## Error codes (Native Create Subscription)

| `resultCode` | `resultMsg` | What to fix |
|---|---|---|
| `0000` | Subscription initiated successfully | Success — proceed to JS Checkout |
| `1007` | Missing mandatory element | Look at `resultMsg` — usually a missing required field; cross-check the field-reference table above |
| `1008` | Pipe character is not allowed | A field contains `\|`; sanitize input |
| `2004` | SSO Token is invalid | Only relevant if you set `paytmSsoToken`; remove it for non-Paytm-ecosystem flows |
| `2007` | Txn amount is invalid | `txnAmount.value` formatting issue (must be string, two decimals, ≥ minimum) |
| `2009` | Duplicate request, same orderId already in progress | Generate a fresh `orderId` |
| `2013` | Mid in query param doesn't match Mid in request | `mid` value must be identical in `?mid=` and in `body.mid` |
| `2014` | OrderId in query param doesn't match OrderId in request | Same — keep `?orderId=` and `body.orderId` identical |
| `4001` | Invalid Frequency Unit / Invalid Subscription Amount Type | `subscriptionFrequencyUnit` or `subscriptionAmountType` value not recognized — verify enum |
| `900` | System error | Paytm-side; retry with the same `orderId` |

---

## Troubleshooting

### "No payment options available" on the consent screen

`/subscription/create` returned a `txnToken` and JS Checkout opened, but the modal shows **"No payment options available"** (or an empty list of methods).

**This is not a code bug — it's a dashboard provisioning issue.** Subscription / UPI Autopay must be explicitly enabled on the MID by Paytm. The API and JS Checkout will let you create tokens against the MID even when the product isn't enabled, so the failure surfaces only at render time.

**Fix:** Contact your Paytm KAM / support and ask them to enable the **Subscription / UPI Autopay** product on the MID. Allow up to 24h for propagation.

### "Invalid Customer ID"

Sanitize `custId` (see "Sanitize `userInfo.custId`" above). Most common cause: passing the customer's name (`"Rahul Sharma"`) directly as the custId.

### `2013` / `2014` — query-param vs body mismatch

Easy to hit when you put `mid` / `orderId` in the URL but forget them in the body (or vice versa). Both are required and must match.

### Wrong endpoint in production

Staging path is `/subscription/create`; production path is `/theia/api/v1/subscription/create`. If your `PAYTM_PG_DOMAIN` switch flips the host but not the path, prod will 404.

---

## Pitfalls

1. **Wrong endpoint.** `/theia/api/v1/initiateTransaction` is for one-time Payment. Subscriptions use `/subscription/create` (staging) or `/theia/api/v1/subscription/create` (prod) — different validators, different responses.
2. **`requestType` must be `"NATIVE_SUBSCRIPTION"` or `"NATIVE_MF_SIP"`** exactly. `"SUBSCRIPTION"` and `"Payment"` both fail.
3. **No `subscriptionDetails` wrapper** — fields are flat inside `body`. Wrapping → 400.
4. **Both `subscriptionFrequency` AND `subscriptionFrequencyUnit` are required.** Earlier versions of this skill said "no subscriptionFrequency field" — that was wrong; restore both.
5. **`subscriptionPaymentMode` is required** — pick one of `CC` / `DC` / `PPI` / `BANK_MANDATE`. For UPI Autopay use `BANK_MANDATE` + `mandateType: "E_MANDATE"`.
6. **Mixed types:** `subscriptionEnableRetry` is string `"1"`/`"0"`; `autoRenewal` / `autoRetry` / `communicationManager` are real booleans. Don't normalize one shape across the board.
7. **`subscriptionStartDate` cannot be in the past** and is conditionally paired with `subscriptionGraceDays` — send both or neither.
8. **`mid` and `orderId` must match** between query string and body — `2013` / `2014` errors otherwise.
9. **`traceId` is required as a query param**, alphanumeric + hyphens / underscores only. Generate one per call.
10. **`txnToken` is single-use, 15-min TTL** — same as one-time payment tokens.
11. **`userInfo.custId` must be sanitized** — most teams hit `"Invalid Customer ID"` by passing real names.
12. **"No payment options available"** at consent time means the MID doesn't have Subscription / UPI Autopay enabled — see Troubleshooting above.
13. **`response.body.authenticated` is the string `"True"` / `"False"`**, not a boolean. Compare as strings.
