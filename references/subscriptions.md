# Paytm Subscriptions / UPI Autopay

Recurring debits with one user-consented mandate. Supported rails: **UPI Autopay** (NPCI), **Cards** (RBI e-mandate), **Net Banking** (limited issuers), **Paytm Wallet**.

---

## Concepts

| Term | Meaning |
|---|---|
| **Mandate** | One-time user authorization at a maximum amount, frequency, and validity window |
| **Subscription ID** | Paytm-issued ID for the mandate, returned after user consent |
| **Charge** | A single debit against an active mandate; happens server-side with no user interaction |
| **Mandate state** | `INITIATED` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `REJECTED` |
| **Pre-notification** | NPCI rule: notify user 24h before debit on UPI Autopay (Paytm handles this) |

---

## Step 1 — Create the mandate (Initiate Transaction)

Same `initiateTransaction` endpoint as one-time payments, but with `requestType: "SUBSCRIPTION"` and a `subscriptionDetails` block:

```
POST {pgDomain}/theia/api/v1/initiateTransaction?mid={MID}&orderId={ORDER_ID}
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "requestType": "SUBSCRIPTION",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "SUB_ORD_001",
    "callbackUrl": "https://yoursite.com/paytm/callback",
    "txnAmount": { "value": "1.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001", "mobile": "9999999999", "email": "buyer@example.com" },

    "subscriptionAmountType": "FIX",
    "subscriptionFrequency": "1",
    "subscriptionFrequencyUnit": "MONTH",
    "subscriptionStartDate": "2025-01-01",
    "subscriptionExpiryDate": "2026-01-01",
    "subscriptionEnableRetry": "1",
    "subscriptionRetryCount": "3",
    "subscriptionGraceDays": "5",
    "subscriptionPaymentMode": [
      { "mode": "UPI" },
      { "mode": "CC" },
      { "mode": "DC" }
    ],
    "renewalAmount": "499.00"
  }
}
```

| Field | Notes |
|---|---|
| `txnAmount.value` | First-debit amount. For mandate-only (no immediate charge) flows, set the **smallest amount allowed** and refund, or use `subscriptionAmountType: "FIX"` with an introductory offer |
| `subscriptionAmountType` | `FIX` (same amount each cycle) or `VARIABLE` (variable, ≤ `subscriptionMaxAmount`) |
| `subscriptionFrequency` + `Unit` | e.g. `1` + `MONTH`, `7` + `DAY`, `1` + `YEAR`. Allowed units: `DAY`, `WEEK`, `MONTH`, `YEAR`, `AS_PRESENTED` |
| `subscriptionStartDate` / `ExpiryDate` | `YYYY-MM-DD` IST. Mandate is dormant before `startDate` |
| `subscriptionMaxAmount` | Required when `AmountType: VARIABLE`. Hard cap per debit |
| `renewalAmount` | Recurring amount Paytm shows on the consent screen |
| `subscriptionEnableRetry` | `1` to auto-retry failed debits |
| `subscriptionRetryCount` | Up to 3 retries per debit cycle |
| `subscriptionGraceDays` | Days after due date Paytm may still try |
| `subscriptionPaymentMode` | Restrict mandate rails |

**Response** → `txnToken`; user completes consent on the JS Checkout page exactly like a one-time payment. After success, the callback / webhook carries `subsId` (mandate id).

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
    "orderId": "SUB_CHARGE_2025_03",
    "txnAmount": { "value": "499.00", "currency": "INR" },
    "renewalDate": "2025-03-01"
  }
}
```

| Field | Notes |
|---|---|
| `orderId` | **Per-charge unique** orderId — same uniqueness rules as one-time payments |
| `txnAmount.value` | Must be ≤ `subscriptionMaxAmount` for VARIABLE mandates; must equal `renewalAmount` for FIX |
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
    "subscriptionExpiryDate": "2027-01-01",
    "renewalAmount": "599.00",
    "subscriptionMaxAmount": "599.00"
  }
}
```

Editable: expiry date, renewal amount, max amount, frequency. **Some changes require a fresh mandate** (rail change, large amount increase) — Paytm returns `EDIT_NOT_ALLOWED` and you must run Step 1 again.

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

1. **First-debit amount is real money.** Many merchants charge ₹1 to set up the mandate, then refund it.
2. **`renewalAmount` is shown on the consent screen** — keep it identical to your marketing copy.
3. **VARIABLE mandates** are not supported on all UPI apps; some users will fall back to FIX-only.
4. **Charge calls need 24h lead time** on UPI Autopay due to NPCI pre-notification.
5. **Card mandates are bound to a tokenized card** — if the card token is deleted (RBI tokenization expiry), the mandate becomes uncharge­able. See `references/tokenization.md`.
6. **Don't mix mandate rails in a single `subscriptionPaymentMode`** unless you've tested all of them — UPI consent screen differs from card consent screen.
7. **Retry logic is mandate-side** (`subscriptionEnableRetry`) — don't double-retry from your code.
8. **Failed charges don't expire the mandate.** Keep retrying via `/subscription/renew` with a new `orderId` each time.
