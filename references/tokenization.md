# Paytm Card Tokenization & Saved Cards

Per RBI's CoF (Card-on-File) tokenization mandate (Oct 2022), merchants **cannot store raw PAN/CVV**. Saved-card flows must use **network tokens** issued by the card scheme (Visa/Mastercard/RuPay) and held by Paytm on behalf of the merchant.

---

## Concepts

| Term | Meaning |
|---|---|
| **PAN** | Primary Account Number (the 16-digit card number) — never stored merchant-side |
| **Network token** | Scheme-issued surrogate for a PAN, valid only for a specific (merchant, customer, card) tuple |
| **CoF token** | Paytm's term for the stored network token |
| **TAVV cryptogram** | Single-use cryptogram returned with the token, required for each charge |
| **TR-ID** (`tokenReferenceId`) | Paytm-side identifier for a saved card; what you store, not the PAN |
| **Card metadata** | Last 4 digits, network, expiry, issuer — safe to store and display |

---

## Lifecycle

```
1. Customer pays first time → opts in to "Save card"
2. Paytm requests token from network → returns TR-ID + card metadata
3. Merchant stores TR-ID + metadata against customer profile
4. Future checkout → merchant sends TR-ID → Paytm fetches cryptogram → charges
5. Card expires / customer revokes → token invalidated → fall back to fresh card entry
```

---

## Step 1 — Opt-in during payment

Add `cardTokenization` to the `initiateTransaction` body:

```json
{
  "body": {
    "requestType": "Payment",
    "...": "...",
    "additionalInfo": {
      "cardTokenRequired": "Y",
      "userConsentForSavingCard": "Y"
    }
  }
}
```

`userConsentForSavingCard` reflects the explicit checkbox the customer ticked on **your** UI (or on Paytm's hosted checkout). RBI requires explicit per-card consent — don't default it on.

After successful payment, `/v3/order/status` response includes:

```json
{
  "body": {
    "savedCardInfo": {
      "tokenReferenceId": "TRID_abc123...",
      "cardLast4Digits": "4242",
      "cardNetwork": "VISA",
      "cardType": "CREDIT",
      "cardIssuer": "HDFC",
      "tokenExpiryMonth": "12",
      "tokenExpiryYear": "2027"
    }
  }
}
```

Persist `tokenReferenceId` + last4 + network + expiry. **Do not** persist anything else card-related.

---

## Step 2 — Charge a saved card

In `initiateTransaction`, restrict payment mode to the saved token:

```json
{
  "body": {
    "requestType": "Payment",
    "mid": "YOUR_MID",
    "websiteName": "YOUR_WEBSITE_NAME",
    "orderId": "ORD_REPEAT_001",
    "callbackUrl": "https://yoursite.com/paytm/callback",
    "txnAmount": { "value": "499.00", "currency": "INR" },
    "userInfo": { "custId": "CUST_001" },
    "enablePaymentMode": [
      {
        "mode": "CC",
        "channels": ["VISA"]
      }
    ],
    "additionalInfo": {
      "tokenReferenceId": "TRID_abc123..."
    }
  }
}
```

Two flows from here:

### A) Server-driven (pure S2S — full Custom UI integration)

After `txnToken`, call:

```
POST {pgDomain}/theia/api/v1/processTransaction
```

with the cryptogram-fetch sub-flow. This requires PCI/SAQ-A scope and explicit Paytm onboarding. Most merchants don't need this.

### B) JS Checkout (recommended)

Pass the same body and let JS Checkout render the saved-card row pre-selected. The user enters CVV (still required for CoF txns) and confirms. No PCI scope on you.

---

## Step 3 — List saved cards for a customer

```
POST {pgDomain}/theia/api/v1/fetchPaymentOptions
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "<txnToken-bound orderId>",
    "tokenType": "TXN_TOKEN",
    "txnToken": "<txnToken>"
  }
}
```

Response → `body.merchantPayOption.paymentModes[]` includes `cards` with each saved token's metadata. Use this to render a "pay with saved card" picker.

> Saved cards are scoped to the **(MID, custId)** pair you pass in `userInfo.custId`. A consistent custId per real user is mandatory or you'll show the wrong cards.

---

## Step 4 — Delete a saved card

```
POST {pgDomain}/theia/api/v1/savedCard/delete
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "custId": "CUST_001",
    "tokenReferenceId": "TRID_abc123..."
  }
}
```

Idempotent. Required by RBI: customers must be able to delete saved cards from your UI.

---

## CVV-less / no-cost-EMI charges

Some merchants are eligible for **CVV-less** repeat charges (e.g. subscription renewals using card mandates). Requires:
- Card mandate (`requestType: SUBSCRIPTION`, mode CC) — see `references/subscriptions.md`.
- Paytm-side enablement on the dashboard.

Without an active mandate, **CVV is required on every CoF charge** — RBI rule, no workaround.

---

## Pitfalls

1. **Never log or store PAN/CVV.** Even in error paths, even temporarily. RBI penalties + scheme fines are punitive.
2. **`tokenReferenceId` is opaque** — treat it as a foreign key, not a card number. Don't try to derive anything from it.
3. **Token expiry tracks card expiry**, not creation date. Refresh metadata on each charge response.
4. **Token is per-MID.** Cards saved on MID-A cannot be charged via MID-B. Multi-MID merchants must re-tokenize per MID.
5. **Token can be revoked by the issuer or scheme** at any time (lost card, fraud) — handle `TOKEN_INVALID` / `TOKEN_EXPIRED` errors at charge time and prompt for fresh card entry.
6. **Per-card consent is mandatory.** A customer ticking "save my card" once does not authorize saving subsequent cards — re-prompt every time.
7. **Show only metadata in your UI** (`•••• 4242 VISA exp 12/27`), never anything that resembles a PAN.
8. **CoF webhook events** (`TOKEN_CREATED`, `TOKEN_DELETED`) may arrive out of order with payment webhooks — handle both.
