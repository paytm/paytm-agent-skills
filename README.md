# paytm-integration-skills

A skill for Paytm Payment Gateway integration — covering JS Checkout, Subscriptions, Payment Links, and QR Codes (Dynamic QR) products.

When installed as skill in Claude, Claude loads this knowledge on demand whenever you ask a Paytm-related question, returning grounded, current answers without you digging through docs.

This skill can be used with AI platforms such as ChatGPT and Gemini by uploading as files as context. Once loaded, it helps generate integration-ready code, debug issues, and guide end-to-end implementation of Paytm Payment Gateway.

---

## What's inside

```
.
├── SKILL.md                          # Entry point + core flow + pitfalls
├── references/
│   ├── js-checkout.md                # Seamless website/app payment experience
│   ├── subscriptions.md              # Automated recurring billing for customers
│   ├── payment-links.md              # Shareable links for easy payment collection
│   ├── qr-codes.md                   # Instant scan & pay with Dynamic QR
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

> *"How do I integrate JS Checkout for my website using Paytm?"*

> *"Show me the step-by-step flow to implement dynamic QR code payments."*

> *"How can I create and manage subscription (UPI Autopay) for monthly billing?"*

> *"What is the best way to handle payment status and callbacks for QR transactions?"*

> *"How do I test end-to-end payment flow using JS Checkout with a sample frontend?"*

---

## Running the reference backends

Each `scripts/backend-*` folder is independently runnable. All three implement the same four endpoints (`/paytm-client-config.json`, `/paytm/create-order`, `/paytm/order-status`, `/paytm/callback`) so you can swap between them while keeping the same `scripts/frontend/js-checkout.html`.

You'll need your own MID and Merchant Key from the [Paytm dashboard](https://dashboard.paytmpayments.com) — see each backend's `README.md` for env vars.

---

## Coverage - edit

- **Core flow:** Initiate Transaction, JS Checkout, callback verification, Transaction Status API
- **Subscriptions:** Mandate setup, recurring charge, lifecycle management
- **Payment Links:** FIXED / REUSABLE / OPEN, fetch, expire
- **QR Codes:** Dynamic QR, Order-based QR, scan, pay, instant confirmation


---

## Important Notes

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
