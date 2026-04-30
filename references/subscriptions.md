# Paytm Subscriptions / UPI Autopay

Recurring debits with one user-consented mandate. Supported rails: **UPI Autopay** (NPCI), **Cards** (RBI e-mandate), **Net Banking** (limited issuers).

> **⚠️ READ THIS FIRST — common mistakes that break subscription integrations:**
>
> 1. The endpoint is **`/theia/api/v1/initiateSubscription`**, NOT `/theia/api/v1/initiateTransaction`.
> 2. `requestType` is **`"NATIVE_SUBSCRIPTION"`**, NOT `"SUBSCRIPTION"` and NOT `"Payment"`.
> 3. Subscription fields are **flat inside `body`** — DO NOT wrap them in a `subscriptionDetails` or `subscriptionInfo` object. Wrapping returns HTTP 400.
> 4. There is **no `subscriptionFrequency`** field. Use `subscriptionFrequencyUnit` only.
> 5. `subscriptionEnableRetry` is a **string** `"1"` / `"0"`, not a boolean.
> 6. `subscriptionStartDate` / `subscriptionExpiryDate` are `YYYY-MM-DD` strings.

---

## Concepts

| Term | Meaning |
|---|---|
| **Mandate** | One-time user authorization at a maximum amount, frequency, and validity window |
| **Subscription ID** | Paytm-issued ID for the mandate, returned after user consent |
| **Charge / Renewal** | A single debit against an active mandate; happens server-side with no user interaction |
| **Mandate state** | `INITIATED` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `REJECTED` |
| **Pre-notification** | NPCI rule: notify user 24h before debit on UPI Autopay (Paytm handles this) |

---

## Step 1 — Create the mandate (Initiate Subscription API)

```
POST {pgDomain}/theia/api/v1/initiateSubscription?mid={MID}&orderId={ORDER_ID}
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
| `txnAmount.value` | ✅ | First-debit amount (often ₹1 for mandate-only flows; refund afterwards) |
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

**Response** → `body.txnToken`. The user completes consent on the JS Checkout page exactly like a one-time payment (see `references/web-integration.md`). After successful consent, the callback / webhook carries `subsId` (mandate id).

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

`txnAmount.value: "1.00"` is the upfront authorization debit; refund it after consent if you don't want to actually charge ₹1. `renewalAmount: "499.00"` is what the mandate debits each month.

---

## Step 2 — Confirm mandate is active

```
POST {pgDomain}/subscription/status
```

```json
{
  "head": { "signature": "<sig>" },
  "body": { "mid": "YOUR_MID", "subsId": "<paytm subsId>" }
}
```

Wait for `subscriptionStatus == "ACTIVE"` before queueing charges. Possible values:
`INITIATED`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `REJECTED`, `SUSPENDED`.

---

## Step 3 — Charge the mandate (recurring debit)

```
POST {pgDomain}/subscription/renew
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "subsId": "<paytm subsId>",
    "orderId": "GYM_CHARGE_2026_05",
    "txnAmount": { "value": "499.00", "currency": "INR" },
    "renewalDate": "2026-05-01"
  }
}
```

| Field | Notes |
|---|---|
| `orderId` | **Per-charge unique** — same uniqueness rules as one-time payments |
| `txnAmount.value` | Must be ≤ `subscriptionMaxAmount` for VARIABLE; must equal `renewalAmount` for FIX |
| `renewalDate` | Logical billing date; used in user-facing communications |

Asynchronous — final state via `/v3/order/status` (with this charge's `orderId`) and via webhook events `SUBSCRIPTION_RENEWAL_SUCCESS` / `SUBSCRIPTION_RENEWAL_FAILURE`.

> **NPCI pre-notification (UPI Autopay):** Paytm sends the user a 24-hour heads-up before debit. Plan charge calls at least 24h ahead of the desired settlement date.

---

## Step 4 — Modify a mandate

```
POST {pgDomain}/subscription/edit
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "subsId": "<paytm subsId>",
    "subscriptionExpiryDate": "2028-05-01",
    "renewalAmount": "599.00",
    "subscriptionMaxAmount": "599.00"
  }
}
```

Editable: expiry date, renewal amount, max amount. **Some changes require a fresh mandate** (rail change, large amount increase) — Paytm returns `EDIT_NOT_ALLOWED` and you must run Step 1 again.

---

## Step 5 — Cancel a mandate

```
POST {pgDomain}/subscription/cancel
```

```json
{
  "head": { "signature": "<sig>" },
  "body": { "mid": "YOUR_MID", "subsId": "<paytm subsId>" }
}
```

Idempotent. Cancellation is final — to resume, create a new mandate.

User can also cancel from their UPI app / bank → you'll receive `SUBSCRIPTION_CANCELLED` webhook.

---

## Webhook events

Configure on dashboard → Webhook Settings → "Subscription". Events:

- `SUBSCRIPTION_INITIATED`
- `SUBSCRIPTION_ACTIVE`
- `SUBSCRIPTION_REJECTED` (with `reason`)
- `SUBSCRIPTION_EXPIRED`
- `SUBSCRIPTION_CANCELLED` (with `cancelledBy: "MERCHANT" | "USER" | "SYSTEM"`)
- `SUBSCRIPTION_RENEWAL_SUCCESS`
- `SUBSCRIPTION_RENEWAL_FAILURE` (with `RESPCODE` / `RESPMSG`)
- `SUBSCRIPTION_PRE_NOTIFICATION_SENT` (UPI Autopay)

Verify `head.signature` exactly like a callback. Webhook is the source of truth — polling `/subscription/status` is a fallback.

---

## Pitfalls

1. **Wrong endpoint.** `/theia/api/v1/initiateTransaction` is for one-time Payment ONLY. Subscriptions use `/theia/api/v1/initiateSubscription`. Different endpoint, different validator, different response.
2. **Wrong `requestType`.** Must be exactly `"NATIVE_SUBSCRIPTION"`. `"SUBSCRIPTION"` and `"Payment"` both fail.
3. **No `subscriptionDetails` wrapper.** All subscription fields are flat inside `body`. Wrapping → HTTP 400.
4. **String, not boolean / number.** `subscriptionEnableRetry: "1"`, not `true` or `1`.
5. **First-debit amount is real money.** Many merchants charge ₹1 to set up the mandate, then refund it.
6. **`renewalAmount` is shown on the consent screen** — keep it identical to your marketing copy.
7. **VARIABLE mandates** are not supported on all UPI apps; some users will fall back to FIX-only.
8. **Charge calls need 24h lead time** on UPI Autopay due to NPCI pre-notification.
9. **Card mandates are bound to a tokenized card** — if the card token is deleted, the mandate becomes uncharge­able. See `references/tokenization.md`.
10. **Failed charges don't expire the mandate.** Keep retrying via `/subscription/renew` with a new `orderId` each time.
