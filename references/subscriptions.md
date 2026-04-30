# Paytm Subscriptions / UPI Autopay

Recurring debits with one user-consented mandate. Supported rails: **UPI Autopay** (NPCI), **Cards** (RBI e-mandate), **Net Banking** (limited issuers).

> **⚠️ READ THIS FIRST — common mistakes that break subscription integrations:**
>
> 1. The endpoint is **`/subscription/create`**, NOT `/theia/api/v1/initiateTransaction`.
> 2. `requestType` is **`"NATIVE_SUBSCRIPTION"`**, NOT `"SUBSCRIPTION"` and NOT `"Payment"`.
> 3. Subscription fields are **flat inside `body`** — DO NOT wrap them in a `subscriptionDetails` or `subscriptionInfo` object. Wrapping returns HTTP 400.
> 4. There is **no `subscriptionFrequency`** field. Use `subscriptionFrequencyUnit` only.
> 5. `subscriptionEnableRetry` is a **string** `"1"` / `"0"`, not a boolean.
> 6. `subscriptionStartDate` / `subscriptionExpiryDate` are `YYYY-MM-DD` strings.

---

## Scope of this skill

This skill covers **only** the mandate-creation flow:
1. Server calls `/subscription/create` to get a `txnToken`.
2. Browser invokes JS Checkout with that `txnToken` so the user can complete the mandate consent.

Subsequent operations (status check, recurring debit, edit, cancel) are intentionally **out of scope**. Do not generate code for `/subscription/status`, `/subscription/renew`, `/subscription/edit`, or `/subscription/cancel` from this skill — refer to live Paytm docs and validate paths before implementing.

---

## Concepts

| Term | Meaning |
|---|---|
| **Mandate** | One-time user authorization at a maximum amount, frequency, and validity window |
| **Subscription ID** | Paytm-issued ID for the mandate, returned after user consent |
| **Mandate state** | `INITIATED` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `REJECTED` |
| **Pre-notification** | NPCI rule: notify user 24h before debit on UPI Autopay (Paytm handles this) |

---

## Step 1 — Create the mandate (server-side)

```
POST {pgDomain}/subscription/create?mid={MID}&orderId={ORDER_ID}
Content-Type: application/json
```

**Request body — note the FLAT structure (no `subscriptionDetails` wrapper):**

```json
{
  "head": { "signature": "<CHECKSUMHASH over JSON.stringify(body)>" },
  "body": {
    "requestType": "NATIVE_SUBSCRIPTION",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "SUB_ORD_001",
    "callbackUrl": "https://yoursite.com/paytm/callback",
    "txnAmount": { "value": "1.00", "currency": "INR" },
    "userInfo": {
      "custId": "CUST_001",
      "mobile": "9999999999",
      "email": "buyer@example.com"
    },

    "subscriptionAmountType": "FIX",
    "renewalAmount": "499.00",
    "subscriptionFrequencyUnit": "MONTH",
    "subscriptionStartDate": "2026-05-01",
    "subscriptionExpiryDate": "2027-05-01",
    "subscriptionEnableRetry": "1",
    "subscriptionRetryCount": "3",
    "subscriptionGraceDays": "5"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `requestType` | ✅ | **Exactly `"NATIVE_SUBSCRIPTION"`** |
| `txnAmount.value` | ✅ | First-debit amount (often ₹1 for mandate-only flows) |
| `subscriptionAmountType` | ✅ | `"FIX"` (same amount each cycle) or `"VARIABLE"` (variable, ≤ `subscriptionMaxAmount`) |
| `renewalAmount` | ✅ | Recurring amount displayed on the consent screen |
| `subscriptionFrequencyUnit` | ✅ | One of: `WEEK`, `MONTH`, `BI_MONTHLY`, `QUARTER`, `SEMI_ANNUALLY`, `YEAR`, `ONDEMAND` |
| `subscriptionStartDate` | ✅ | `YYYY-MM-DD` IST. Mandate dormant before this date |
| `subscriptionExpiryDate` | ✅ | `YYYY-MM-DD` IST |
| `subscriptionEnableRetry` | optional | String `"1"` / `"0"` |
| `subscriptionRetryCount` | optional | Up to `"3"` |
| `subscriptionGraceDays` | optional | Days after due date Paytm may still try |
| `subscriptionMaxAmount` | conditional | **Required** when `subscriptionAmountType: "VARIABLE"` |
| `subscriptionPaymentMode` | optional | Restrict mandate rails: `[{ "mode": "UPI" }, { "mode": "CC" }, { "mode": "DC" }]` |

**Response** → `body.txnToken` (single-use, 15-min TTL). Pass it to JS Checkout in Step 2.

### Worked example — gym membership ₹499/month

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "requestType": "NATIVE_SUBSCRIPTION",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "GYM_SUB_2026_001",
    "callbackUrl": "https://gymsite.com/paytm/callback",
    "txnAmount": { "value": "1.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_42", "mobile": "9999999999", "email": "ankit@example.com" },
    "subscriptionAmountType": "FIX",
    "renewalAmount": "499.00",
    "subscriptionFrequencyUnit": "MONTH",
    "subscriptionStartDate": "2026-05-01",
    "subscriptionExpiryDate": "2027-05-01",
    "subscriptionEnableRetry": "1",
    "subscriptionGraceDays": "5"
  }
}
```

`txnAmount.value: "1.00"` is the upfront authorization debit. `renewalAmount: "499.00"` is what the mandate would debit each month once active.

---

## Step 2 — Invoke JS Checkout for consent

Same JS Checkout flow as a one-time payment — only the `txnToken` source differs (it came from `/subscription/create`, not `/theia/api/v1/initiateTransaction`). The browser code is identical:

```html
<script src="{pgDomain}/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
<script>
  window.Paytm.CheckoutJS.onLoad(function () {
    window.Paytm.CheckoutJS.init({
      root: "",
      flow: "DEFAULT",
      data: {
        orderId: "GYM_SUB_2026_001",
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

Full reference, callback handling, and pitfalls are in `references/js-checkout.md`. The user sees the Paytm consent screen showing the **`renewalAmount`** + frequency, approves the mandate, then Paytm POSTs to your `callbackUrl` with the standard fields plus `subsId` (the mandate id).

> **Verify `CHECKSUMHASH` on the callback** before treating the mandate as set up — same scheme as one-time payments. See `references/js-checkout.md` for callback-verification details.

---

## Pitfalls

1. **Wrong endpoint.** `/theia/api/v1/initiateTransaction` is for one-time Payment ONLY. Subscriptions use `/subscription/create`. Different endpoint, different validator, different response.
2. **Wrong `requestType`.** Must be exactly `"NATIVE_SUBSCRIPTION"`. `"SUBSCRIPTION"` and `"Payment"` both fail.
3. **No `subscriptionDetails` wrapper.** All subscription fields are flat inside `body`. Wrapping → HTTP 400.
4. **String, not boolean / number.** `subscriptionEnableRetry: "1"`, not `true` or `1`.
5. **First-debit amount is real money.** Many merchants charge ₹1 to set up the mandate, then refund it out of band.
6. **`renewalAmount` is shown on the consent screen** — keep it identical to your marketing copy.
7. **VARIABLE mandates** are not supported on all UPI apps; some users will fall back to FIX-only.
8. **`subscriptionStartDate` cannot be in the past** and must be ≥ today (IST).
9. **`txnToken` from `/subscription/create` is single-use, 15-min TTL** — same as one-time payment tokens.
