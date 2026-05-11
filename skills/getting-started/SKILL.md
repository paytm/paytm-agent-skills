---
name: paytm-getting-started
description: >
  First-step setup for Paytm Payment Gateway: where to get MID + Merchant Key (staging vs prod),
  staging-vs-prod environment URLs, .env / .env.example conventions, dashboard access, and the
  decision tree for picking the right Paytm flow (one-time payment vs subscription vs payment link
  vs dynamic QR). Load this skill whenever the user is starting a fresh Paytm integration, asking
  about credentials/environments/dashboard, or unsure which Paytm product fits their use case.
triggers:
  - "PAYTM_MID"
  - "PAYTM_MERCHANT_KEY"
  - "WEBSTAGING"
  - "paytmpayments.com/docs"
  - "dashboard.paytmpayments.com"
---

# Paytm: Getting Started

## What Paytm PG covers

Paytm Payment Gateway supports **UPI, Credit Cards, Debit Cards, Net Banking, EMI**.
Four integration variants — pick one before writing any code:

| User says… | Flow | Endpoint | Skill to load |
|---|---|---|---|
| "checkout page", "pay button", "one-time payment", "buy" | **JS Checkout (Payment)** | `POST /theia/api/v1/initiateTransaction` (`requestType: "Payment"`) | `js-checkout` |
| "subscription", "monthly", "weekly", "yearly", "recurring", "auto-debit", "autopay", "mandate", "renew", "membership" | **Subscription** | `POST /subscription/create` (`requestType: "NATIVE_SUBSCRIPTION"`) | `subscriptions` |
| "shareable link", "invoice link", "payment link via SMS / WhatsApp / email" | **Payment Link** | `POST /link/create` | `payment-links` |
| "QR code", "scan to pay", "in-store", "counter", "table-side", "print QR" | **Dynamic QR** | `POST /paymentservices/qr/create` | `qr-codes` |

**Picking wrong = silent failure in production.** If the prompt is ambiguous (*"accept ₹1 payments"*, *"integrate Paytm"*), ask one clarifying question before generating: *"Is this a one-time payment, recurring subscription, shareable link, or QR for in-store?"*

---

## Environments

| Environment | Base URL |
|---|---|
| Staging | `https://securestage.paytmpayments.com` |
| Production | `https://secure.paytmpayments.com` |

Staging works immediately. Production needs KYC + activation.

---

## Get your MID and Merchant Key

You need a **MID** (Merchant ID) and **Merchant Key** for each environment — staging and production keys are NOT interchangeable.

- *Staging (test mode):* https://dashboard.paytmpayments.com/next/apikeys -> Generate now (under Test API Details)
- *Production (Live Mode):* https://dashboard.paytmpayments.com/next/apikeys -> Get Merchant ID, Merchant Key from Production API details.

  (Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding or contact your Paytm KAM.)

Store both in environment variables (`PAYTM_MID`, `PAYTM_MERCHANT_KEY`) — never commit them or expose in client-side code.

---

## .env conventions (apply to every generated `.env` / `.env.example`)

- **`PAYTM_ENVIRONMENT` is always the first variable** — everything else derives from it.
- **Pre-fill staging values** so the file works out of the box.
- **Wrap every value in double quotes**, not just secrets. Avoids edge cases — `#` in keys silently truncates unquoted values.
- **Generic placeholders** — `YOUR_MID`, not `YOUR_STAGING_MID_HERE`. Environment lives in `PAYTM_ENVIRONMENT`.
- **All mandatory keys at the top, comments / optional overrides in a later section.**

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
# Everything below is optional - leave commented unless you need to override.
# ---------------------------------------------------------------------------
# PAYTM_PG_DOMAIN=""               # auto-derived from PAYTM_ENVIRONMENT
# PAYTM_CALLBACK_URL=""            # auto-derived from PAYTM_CALLBACK_BASE
# PAYTM_STATUS_API_URL=""          # auto-derived from PAYTM_PG_DOMAIN
# NODE_EXTRA_CA_CERTS="./certs/corp-proxy-ca.crt"   # only when behind a corporate proxy with a custom CA
```

### Why double-quote the merchant key

Paytm Merchant Keys often contain `#`, `@`, `!`, `$`, or `%`. In `.env`, an unquoted `#` is treated as a comment — everything after it is dropped. Symptom: checksum generation produces wrong signatures, Paytm responds with `resultCode: 227`. Always quote.

```bash
# ❌ Wrong - any '#' in the key truncates the value
PAYTM_MERCHANT_KEY=ab#cd@1234XYZ

# ✅ Correct
PAYTM_MERCHANT_KEY="ab#cd@1234XYZ"
```

### Don't hard-code absolute paths

Symptom: Project ships with `NODE_EXTRA_CA_CERTS=/Users/someone-else/certs/...` baked into `.env`. Works on author's machine, breaks everywhere else.
Fix: project-relative paths (`./certs/corp-proxy-ca.crt`). Document in README that corp-proxy users may need to point this at their CA bundle.

### Don't use `https://localhost`

`PAYTM_CALLBACK_URL=https://localhost:3001/...` — Paytm POSTs the callback, browser blocks the redirect because there's no SSL on localhost. Payment "succeeds" silently. Use `http://localhost:3001` for local dev.

---

## Key Concepts

| Concept | Description |
|---|---|
| **MID** | Merchant ID — unique identifier for your Paytm account |
| **Merchant Key** | Secret key used to generate/verify checksums |
| **txnToken** | Short-lived token returned by Initiate Transaction; used in subsequent steps. 15-min TTL, single-use. |
| **CHECKSUMHASH** | HMAC-SHA256 signature generated with Merchant Key to authenticate API calls |
| **ORDER_ID** | Unique merchant-generated identifier per transaction. Single-use even on failure. |
| **callbackUrl** | URL where Paytm POSTs transaction result after payment |
| **`websiteName`** | Per-MID identifier from the dashboard (e.g. `WEBSTAGING`, `DEFAULT`, `retail`). Wrong value → `initiateTransaction` fails. |

---

## Where to go next

Pick the matching skill from the table at the top, or load `troubleshooting` if you're debugging an existing integration.
