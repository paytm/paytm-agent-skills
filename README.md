# paytm-integration-skills

A [Claude Skill](https://docs.anthropic.com/en/docs/claude-code/skills) for Paytm Payment Gateway integration — covering APIs, SDKs, checksums, callbacks, webhooks, refunds, subscriptions, tokenization, payment links, QR codes, and affordability products.

When installed, Claude loads this knowledge on demand whenever you ask a Paytm-related question, returning grounded, current answers without you digging through docs.

---

## What's inside

```
.
├── SKILL.md                          # Entry point + core flow + pitfalls
├── references/
│   ├── web-integration.md            # JS Checkout, callback fields, non-SDK form POST
│   ├── mobile-sdk.md                 # Android, iOS, React Native, Flutter
│   ├── troubleshooting.md            # Symptom → cause → fix tree, RESPCODE table
│   ├── refunds.md                    # apply/status/webhook lifecycle, partial refunds
│   ├── subscriptions.md              # UPI Autopay & card mandates: charge/edit/cancel
│   ├── payment-links.md              # FIXED / REUSABLE / OPEN links
│   ├── tokenization.md               # RBI-compliant saved cards (network tokens)
│   ├── webhooks.md                   # S2S signature verification + event reference
│   ├── qr-codes.md                   # Dynamic & static QR generation
│   └── affordability.md              # EMI, No-Cost EMI, BNPL, Bank Offers
└── scripts/
    ├── backend-node/                 # Express + paytmchecksum reference backend
    ├── backend-spring/               # Spring MVC + RestTemplate reference backend
    ├── backend-python/               # Flask + paytmchecksum reference backend
    └── frontend/
        └── js-checkout.html          # Minimal copy-paste browser page
```

`SKILL.md` is the entry point with YAML frontmatter — Claude reads it first, then pulls in `references/` files only when relevant to the user's question.

---

## Install as a Claude Code skill

Clone into your Claude skills directory:

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/paytm/paytm-integration-skills.git ~/.claude/skills/paytm-integration
```

Restart Claude Code (or reload skills). Verify:

```bash
# In Claude Code
/skills
```

You should see `paytm-integration` listed. From then on, any Paytm-related question auto-loads the skill.

---

## Usage examples

> *"How do I generate a checksum for the Initiate Transaction API in Python?"*

> *"Walk me through integrating Paytm All-in-One SDK in React Native."*

> *"What does RESPCODE 227 mean and how do I fix it?"*

> *"Set up UPI Autopay with monthly debits of ₹499."*

> *"Show me a working Flask backend for JS Checkout."*

---

## Running the reference backends

Each `scripts/backend-*` folder is independently runnable. All three implement the same four endpoints (`/paytm-client-config.json`, `/paytm/create-order`, `/paytm/order-status`, `/paytm/callback`) so you can swap between them while keeping the same `scripts/frontend/js-checkout.html`.

You'll need your own MID and Merchant Key from the [Paytm dashboard](https://dashboard.paytmpayments.com) — see each backend's `README.md` for env vars.

---

## Coverage

- **Core flow** — Initiate Transaction, JS Checkout, callback verification, Transaction Status API
- **Refunds** — Apply, status, partial refunds, webhook lifecycle
- **Subscriptions** — UPI Autopay & card mandates, charge/edit/cancel, NPCI pre-notification
- **Payment Links** — FIXED / REUSABLE / OPEN, fetch, expire
- **Tokenization** — RBI-compliant saved cards, CVV-less repeat charges
- **Webhooks** — S2S signature verification, retry/idempotency semantics, full event catalogue
- **QR Codes** — Dynamic & static, generation and reconciliation
- **Affordability** — Standard EMI, No-Cost EMI, Cardless EMI / BNPL, Bank Offers
- **Mobile SDKs** — Android, iOS, React Native, Flutter
- **Troubleshooting** — Decision tree, RESPCODE catalogue, common pitfalls

---

## Contributing

PRs welcome. Please:
- Keep API examples grounded in current [Paytm docs](https://www.paytmpayments.com/docs/) — link to the source where reasonable.
- Match the existing reference-doc structure (concepts → endpoints → field tables → pitfalls).
- Use `YOUR_MID`, `YOUR_MERCHANT_KEY`, etc. as placeholders — never commit real credentials.

---

## Links

- [Paytm Developer Docs](https://www.paytmpayments.com/docs/)
- [Paytm Dashboard](https://dashboard.paytmpayments.com)
- [Checksum Library](https://www.paytmpayments.com/docs/checksum/)
- [Server SDKs](https://www.paytmpayments.com/docs/server-sdk/)
- [Claude Skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills)

---

## License

MIT
