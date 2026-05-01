# Paytm Integration Skills

**Integrate Paytm Payment Gateway in minutes, just by describing what you want to build.**

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-D97757)](https://docs.anthropic.com/en/docs/claude-code/skills)
[![Paytm PG](https://img.shields.io/badge/Paytm-Payment%20Gateway-002970)](https://www.paytmpayments.com/business-payments)

This repository provides ready-to-use integration skills that allow LLM-powered agents (Claude, ChatGPT, Gemini) to initiate and manage payments via [Paytm PG](https://www.paytmpayments.com/docs). Just describe your business in plain English, the agent generates production-ready integration code for you.

The skill teaches your AI agent the full Paytm spec, integration patterns, and common pitfalls, so the code it generates works on the first try.

---

## 1. Supported Products

| Product | Description |
|---|---|
| **JS Checkout** | Hosted checkout for web/app payments |
| **Subscriptions** | Recurring payments with auto-debit |
| **Payment Links** | Generate and share payment links |
| **QR Codes** | Dynamic QR for in-person UPI payments |

---

## 2. Sample queries

**JS Checkout**
> *"I run an online store selling t-shirts. Help me integrate Paytm so customers can pay with UPI or cards at checkout."*

**Subscriptions**
> *"I am building a fitness app with a ₹499 monthly plan. Integrate Paytm so users get charged automatically every month."*

**Payment Links**
> *"I am a freelance designer. I want to generate Paytm payment links for my clients, share them, and track which ones have been paid. Build this for me."*

**QR Codes**
> *"I run a small cafe. Integrate Paytm so I can show a QR at my counter and enter the bill amount for each customer."*

---

## 3. Setup

The skill file (`SKILL.md`) acts as the instruction layer that teaches the AI how to correctly implement Paytm integrations.

### Claude (Claude Code, Claude.ai, Claude API)

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/paytm/paytm-integration-skills.git ~/.claude/skills/paytm-integration
```

Restart Claude Code, run `/skills` to verify. Any Paytm prompt now auto-loads the skill.

For Claude.ai or the API: attach `SKILL.md` and the `references/` folder as project files.

### ChatGPT, Gemini, and other LLMs

Download `SKILL.md`, then:
- **ChatGPT:** upload as a file in a Project or Custom GPT, or paste into system instructions.
- **Gemini / others:** attach as a file, or paste into the system prompt.

Optionally attach files from `references/` for deeper coverage.

---

## 4. What's inside

Repository structure:

```
.
├── SKILL.md                  # Entry point: core flow, pitfalls
├── references/
│   ├── js-checkout.md
│   ├── subscriptions.md
│   ├── payment-links.md
│   └── qr-codes.md
└── scripts/                  # Runnable reference implementations
    ├── backend-node/         # Express + paytmchecksum
    ├── backend-spring/       # Spring MVC + RestTemplate
    ├── backend-python/       # Flask + paytmchecksum
    └── frontend/
        └── js-checkout.html  # Copy-paste browser page
```

---

## 5. Important notes

To go live with Paytm, you will need a **MID** (your unique Merchant ID) and a **Merchant Key** (your secret key) for both staging and production. Each environment has its own pair, staging keys will not work in production and vice versa.

- **Staging credentials:** [Paytm Business Dashboard](https://dashboard.paytmpayments.com) → toggle **Test Data** mode → API Keys
- **Production credentials:** [Paytm Business Dashboard](https://dashboard.paytmpayments.com) → **Live Mode** → API Keys

Store keys in environment variables. Never commit them or expose them in client-side code.

---

## License

MIT, see [LICENSE](LICENSE).

---

Built and maintained by the Paytm Payments developer team. Issues and PRs welcome.
