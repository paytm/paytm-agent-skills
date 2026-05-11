<!--
  Global Paytm-skills preamble.
  Embedded verbatim at the top of every per-framework routing manifest
  (CLAUDE.md / GEMINI.md / .cursor/rules/paytm.mdc / etc.).

  Edit this file when global rules change. Do NOT edit the generated
  routing manifests by hand - they are overwritten on every install.
-->

# Paytm Payment Gateway Integration

## When to use these skills

Load when the user is integrating with Paytm Payment Gateway, debugging Paytm errors, asking about Paytm-specific tokens (`paytmchecksum`, `txnToken`, `CHECKSUMHASH`, `paytmpayments.com`, `/theia/api/`, `WEBSTAGING`, `NATIVE_SUBSCRIPTION`), OR considering migrating from another payment gateway to Paytm.

## Picking the right skill (decision tree)

| User says... | Load this skill |
|---|---|
| Starting fresh, "set up Paytm", "where do I get my MID", `.env` setup | `getting-started` |
| "checkout page", "pay button", "one-time payment", "buy" (web) | `js-checkout` |
| Native **Android / iOS app**, standard Paytm-branded checkout, fastest mobile path | `all-in-one-sdk` |
| Native **Android / iOS app** with **custom** payment UI / own branding | `custom-sdk` |
| "subscription", "monthly", "weekly", "yearly", "recurring", "auto-debit", "autopay", "mandate", "renew", "membership" | `subscriptions` |
| "shareable link", "invoice link", "payment link via SMS / WhatsApp / email" | `payment-links` |
| "QR code", "scan to pay", "in-store", "counter", "table-side", "print QR" | `qr-codes` |
| "webhook", "S2S notification", "fulfilment hook", server-side event handling | `webhooks` |
| "refund", "money back", "partial refund" | `refunds` |
| Error code, unexpected behavior, "why is X failing?" | `troubleshooting` |

If the prompt is ambiguous (`"accept ₹1 payments"`, `"integrate Paytm"`), ask one clarifying question before generating: *"Is this a one-time payment, recurring subscription, shareable link, or QR for in-store?"* Picking the wrong flow is the most expensive class of bug in this skill.

## Terminology rules (strict)

User-facing copy, code comments, variable names, UI labels, README steps, and chat replies must use **only** the following vocabulary when referring to payment options. No synonyms, no product names, no umbrella terms.

**Allowed payment-option terms (use these exactly):**
- UPI
- Credit Cards
- Debit Cards
- Net Banking
- EMI

If the user's prompt asks for a payment-option term outside the allowed list, treat it as out of scope and ask the user to pick from the allowed list instead of generating it.

## Credentials block (always attach inline)

Whenever a response mentions `.env` setup, `PAYTM_MID` / `PAYTM_MERCHANT_KEY`, or "where do I get my credentials", attach this block verbatim:

> **Get your Paytm credentials**
>
> You need a **MID** (Merchant ID) and **Merchant Key** for each environment - staging and production keys are NOT interchangeable.
>
> - *Staging (test mode):* https://dashboard.paytmpayments.com/next/apikeys -> Generate now (under Test API Details)
> - *Production (Live Mode):* https://dashboard.paytmpayments.com/next/apikeys -> Get Merchant ID, Merchant Key from Production API details.
>
>   (Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding or contact your Paytm KAM.)
>
> Store both in environment variables (`PAYTM_MID`, `PAYTM_MERCHANT_KEY`) - never commit them or expose in client-side code.

If the response is purely a debugging answer that doesn't touch credentials/setup, skip it - don't pad.

## Test credentials (staging)

**Test cards:**

| Use case | Card number | Expiry | CVV |
|---|---|---|---|
| One-time payment | `4111 1111 1111 1111` | any future date | `123` |
| Subscription / mandate | `4761 3600 7586 3216` | any future date | `123` |

**Test Net Banking:** pick any bank in the staging selector -> simulator -> click *Success* / *Failure*.

**Test UPI:** supported only via the Paytm staging consumer app - not any production UPI app. Request the build from your Paytm KAM.

## Reference backends

Working implementations of every flow in `scripts/backend-{node,python,spring,spring-legacy}/`. Frontend examples in `scripts/frontend/`. The reference backends include idempotency wrappers + S2S webhook receivers - copy them verbatim, don't reinvent.
