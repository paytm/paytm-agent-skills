# paytm-integration-skills

Integrate with Paytm payments products seamlessly in one shot. 

**Products:**  JS Checkout, Subscriptions (UPI Autopay), Payment Links, and Dynamic QR Codes.

**Claude Code:** Install as a skill and get instant, context-aware Paytm answers auto-loaded into every session.

**ChatGPT/Gemini:** Upload as a file to give context to generate code, debug issues, and guide integration.

---

## What's inside

```
.
├── SKILL.md                          # Entry point + core flow + pitfalls
├── references/
│   ├── js-checkout.md                # Seamless website/app payment experience
│   ├── subscriptions.md              # Automated recurring payments for customers
│   ├── payment-links.md              # Shareable links for easy payment collection
│   ├── qr-codes.md                   # Scan & pay with Dynamic QR using UPI
└── scripts/
    ├── backend-node/                 # Express + paytmchecksum reference backend
    ├── backend-spring/               # Spring MVC + RestTemplate reference backend
    ├── backend-python/               # Flask + paytmchecksum reference backend
    └── frontend/
        └── js-checkout.html          # Minimal copy-paste browser page
```

`SKILL.md` is the entry point with YAML frontmatter; Claude reads it first, then pulls in `references/` files only when relevant to the user's question.

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

You'll need your own MID and Merchant Key from the [Paytm dashboard](https://dashboard.paytmpayments.com) see each backend's `README.md` for env vars.

---

## Coverage 

- **Core flow:** Initiate Transaction, JS Checkout, callback verification, Transaction Status API
- **Subscriptions:** Mandate setup, recurring payments, lifecycle management
- **Payment Links:** FIXED / REUSABLE / OPEN, create, fetch, expire
- **QR Codes:** Dynamic QR, scan, pay


---

## Important Notes

- Keep API examples grounded in current [Paytm docs](https://www.paytmpayments.com/docs/) link to the source where reasonable.
- Match the existing reference-doc structure (concepts → endpoints → field tables → pitfalls).
- Use `YOUR_MID`, `YOUR_MERCHANT_KEY`, etc. as placeholders never commit real credentials.

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
