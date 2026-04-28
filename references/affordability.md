# Paytm Affordability — EMI, BNPL, Bank Offers

Affordability options surface inside the standard JS Checkout / All-in-One SDK once enabled on the dashboard. Most of the work is configuration; the API surface is small and overlays the standard payment flow.

---

## Product map

| Product | What it does | Settlement |
|---|---|---|
| **Standard EMI** | Customer's bank converts a card payment into installments at the bank's EMI rates | Merchant gets full amount T+1 (bank charges customer over months) |
| **No-Cost EMI** | Same as above, but merchant absorbs the interest as an upfront discount; customer pays principal only | Merchant gets full amount minus discount T+1 |
| **Cardless EMI / BNPL** | Lender (Paytm Postpaid, ZestMoney, KreditBee, etc.) underwrites at checkout | Merchant gets full amount; lender collects from customer |
| **Bank Offers** | Instant discount / cashback on specific cards / wallets | Net debit reduced at checkout |

All of these require **separate dashboard enablement per product per MID** — they don't auto-appear from the API alone.

---

## Step 1 — Enable on dashboard

Dashboard → **Affordability** → enable products → for No-Cost EMI / Bank Offers, configure tenure × bank × discount-rate matrix → publish. Allow up to 24h for propagation.

---

## Step 2 — Discover available offers

Before rendering checkout, fetch what applies to this cart:

```
POST {pgDomain}/theia/api/v2/fetchPaymentOptions
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "<orderId from initiateTransaction>",
    "tokenType": "TXN_TOKEN",
    "txnToken": "<txnToken>"
  }
}
```

Response → `body.merchantPayOption.paymentModes[]`. Each mode entry includes:

- `payMode`: `EMI`, `NB`, `CC`, `DC`, `UPI`, `PPI`, `PAYTM_DIGITAL_CREDIT`
- `payChannelOptions[]`: per-bank/per-tenure rows for EMI
- `instrumentDetails`: discount/offer terms
- `emiBanksOffers[]`: matrix of `{ bankName, tenureMonths, monthlyAmount, interestRate, processingFee }`

Use this to render an "EMI options" picker before invoking checkout, or just let JS Checkout render the default UI.

---

## Step 3 — Force / restrict to EMI in checkout

Pass `enablePaymentMode` in `initiateTransaction`:

```json
{
  "body": {
    "...": "...",
    "enablePaymentMode": [
      {
        "mode": "EMI",
        "channels": ["HDFC", "ICICI", "AXIS", "SBI", "KOTAK"]
      }
    ]
  }
}
```

For a single tenure or no-cost EMI plan ID, also pass:

```json
{
  "additionalInfo": {
    "emiPlanId": "<planId from fetchPaymentOptions>"
  }
}
```

---

## Step 4 — No-Cost EMI display

The **discount** for No-Cost EMI is not a separate transaction — it's reflected in the EMI matrix. Merchant-side responsibility:

1. Show the original price (`₹10,000`).
2. Show the no-cost EMI option (`₹1,667 × 6 months, no interest`).
3. The customer pays `₹10,000` to their bank over 6 months; merchant receives `~₹9,500` (net of the merchant-borne interest the bank charges).

The `merchantPayOption` response includes `subventionAmount` per row — that's the merchant-borne interest.

---

## Step 5 — Bank Offers (instant discount)

Configured on dashboard; surfaces automatically. The customer sees the discount applied at the payment page.

For server-side awareness (to show "₹500 off with HDFC card!" on your product page before checkout):

```
POST {pgDomain}/theia/api/v1/fetchOffer
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "txnAmount": { "value": "10000.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001" }
  }
}
```

Response carries the active offers and their eligibility rules.

---

## Cardless EMI / BNPL (Postpaid, ZestMoney, etc.)

These appear as separate `paymentModes` — typically `mode: "PAYTM_DIGITAL_CREDIT"` for Postpaid, or under a `BNPL` umbrella for partners. Flow:

1. Customer selects Postpaid / BNPL on the checkout page.
2. Lender's flow runs inline (KYC if first-time, OTP for repeat).
3. Lender approves → payment completes like a regular txn.
4. Merchant receives full amount T+1.

No special integration on the merchant side — enabling on the dashboard is the only step. Eligibility is per-customer per-lender (Paytm + lender determine in real-time).

---

## Pitfalls

1. **Affordability products appear only after dashboard enablement** — code-only changes won't surface them.
2. **No-Cost EMI is merchant-funded.** Set the cap (`maxSubventionAmount`) carefully — runaway promos drain margins.
3. **EMI eligibility is bank-side**: the same card may show different tenures for different amounts. Don't cache eligibility long-term.
4. **Bank Offers stack (or don't) per Paytm rules** — test with real cards in staging before launching.
5. **Refunds on EMI** reverse the principal; the bank reverses the interest accrued so far. Customer may see partial debits even after a refund.
6. **`fetchOffer` is rate-limited** — use it on the cart page once, not on every keystroke.
7. **Cardless EMI declines are common** for first-time users — keep alternative payment methods on the page.
8. **Settlement net-of-discount** can confuse accounting: reconcile against Paytm's MDR + offer breakdown in the Settlement Report, not against your gross order value.
