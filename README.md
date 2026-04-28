# paytm-integration-skills

A collection of Claude Skills for Paytm Payment Gateway integration — covering APIs, SDKs, checksums, webhooks, and more.

These `.skill` files plug into [Claude](https://claude.ai) to give it deep, accurate knowledge of Paytm's developer ecosystem, so you can get expert integration help without digging through docs every time.

---

## What are Claude Skills?

Claude Skills are packaged knowledge bundles that Claude loads on demand. When you ask a Paytm-related question, Claude automatically reads the relevant skill and responds with precise, context-aware guidance — correct API endpoints, proper checksum logic, the right SDK methods, etc.

Install a `.skill` file once in your Claude environment, and it's available across all your conversations.

---

## Skills in this repo

| Skill | Description |
|---|---|
| [`paytm-integration`](./paytm-integration/) | Core Paytm PG integration: Initiate Transaction, checksum generation, JS Checkout, All-in-One SDK, Transaction Status, Refunds, UPI Autopay |

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/paytm/paytm-integration-skills.git
```

### 2. Install a skill

Download the `.skill` file for the skill you want, then install it in your Claude environment per your setup (Claude Code, Claude.ai, or your own Claude-powered app).

### 3. Start asking

Once installed, just ask Claude naturally:

> *"How do I generate a checksum for the Initiate Transaction API in Python?"*

> *"Walk me through integrating Paytm All-in-One SDK in React Native."*

> *"What does RESPCODE 227 mean and how do I fix it?"*

Claude will automatically use the skill to give you accurate, grounded answers.

---

## Skill structure

Each skill follows this layout:

```
skill-name/
├── SKILL.md              # Core instructions + API reference
└── references/
    ├── mobile-sdk.md     # Android, iOS, React Native, Flutter
    └── web-integration.md  # JS Checkout, form POST, Payment Links
```

`SKILL.md` is the entry point. Reference files are loaded by Claude only when relevant to your question, keeping context lean and responses fast.

---

## Coverage

The `paytm-integration` skill currently covers:

- **Authentication** — Checksum generation and verification (Java, Python, PHP, Node.js, .NET)
- **Initiate Transaction API** — Request structure, parameters, txnToken handling
- **JS Checkout** — Web integration with `window.Paytm.CheckoutJS`
- **All-in-One SDK** — Android, iOS, React Native, Flutter, Ionic, Cordova, Unity
- **Custom UI SDK** — Native mobile integration with full UI control
- **Callback handling** — Parsing Paytm's POST response, status values
- **Transaction Status API** — Server-side verification (the authoritative final status)
- **Refunds** — Initiate and query refund status
- **UPI Autopay / Subscriptions** — Recurring mandate creation
- **Payment Links** — Programmatic link generation API
- **eCommerce Plugins** — WooCommerce, Magento, Shopify, PrestaShop, OpenCart
- **Test credentials** — Staging environment setup and test data
- **Error codes** — Common RESPCODE values and fixes

---

## Contributing

Contributions are welcome. To add a new skill or improve an existing one:

1. Fork the repo
2. Create your skill directory under a descriptive name
3. Follow the `SKILL.md` structure (YAML frontmatter with `name` and `description` fields, then Markdown body)
4. Add reference files under `references/` for any deep-dive content
5. Open a pull request with a clear description of what the skill covers

Please keep skill content accurate and tested against current Paytm API documentation at [paytmpayments.com/docs](https://www.paytmpayments.com/docs).

---

## Links

- [Paytm Developer Docs](https://www.paytmpayments.com/docs/)
- [Paytm Dashboard](https://dashboard.paytmpayments.com)
- [Checksum Library](https://www.paytmpayments.com/docs/checksum/)
- [Server SDKs](https://www.paytmpayments.com/docs/server-sdk/)
- [API Reference](https://www.paytmpayments.com/docs/api/initiate-transaction-api)

---

## License

MIT
