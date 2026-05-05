# Paytm Integration Skills

**Integrate Paytm Payment Gateway in minutes, just by describing what you want to build.**

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-D97757)](https://docs.anthropic.com/en/docs/claude-code/skills)
[![Paytm PG](https://img.shields.io/badge/Paytm-Payment%20Gateway-002970)](https://www.paytmpayments.com/docs)

This repository provides ready-to-use integration skills that allow LLM-powered agents (Claude, ChatGPT) to initiate and manage payments via [Paytm PG](https://www.paytmpayments.com/docs). Just describe your business in plain English, the agent generates production-ready integration code for you.

The skill teaches your AI agent the full Paytm spec, integration patterns, and common pitfalls, so the code it generates works on the first try.

---

## 1. Supported Products

| Product | Description |
|---|---|
| **JS Checkout** | Paytm hosted checkout page for web/app payments |
| **Subscriptions** | Recurring payment collections through UPI Autopay, cards or eNACH |
| **Payment Links** | Generate and share payment links for payment collections |
| **QR Codes** | Display dynamic QR codes on your website for UPI payments |

---

## 2. Sample queries

**JS Checkout**
> *"I run an online store selling t-shirts. Help me integrate Paytm so customers can pay with UPI or cards at checkout."*

**Subscriptions**
> *"I am building a fitness app with a ₹499 monthly plan. Integrate Paytm so users get charged automatically every month."*

**Payment Links**
> *"I am a freelance designer. I want to generate payment links for my clients, share them, and track which ones have been paid. Build this for me."*

**QR Codes**
> *"I run a cloud kitchen business. Integrate Paytm to display a QR code on my website with the bill amount for customers to scan and pay via UPI."*

---

## 3. Setup

The skill file (`SKILL.md`) acts as the instruction layer that teaches the AI how to correctly implement Paytm integrations.

### Claude (Claude Code, Claude.ai)

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/paytm/paytm-integration-skills.git ~/.claude/skills/paytm-integration
``` 
OR

Run this prompt in Claude Code to install the skill globally:
```bash
Install the Paytm PG integration skill globally from https://github.com/paytm/paytm-integration-skills
``` 

- **Claude Code:** Restart Claude Code, run `/skills` to verify. Any Paytm prompt now auto-loads the skill.  
- **Claude.ai:** Add `SKILL.md` and the `references/` files as project files, every Paytm prompt in that project loads them automatically.    

### Codex

Install the skill into Codex using either of:

1. Run the skill installer:
   ```
   $skill-installer install "https://github.com/paytm/paytm-integration-skills/"
   ```

2. Or simply prompt Codex:
   ```
   Install the skill from https://github.com/paytm/paytm-integration-skills/
   ```

Once installed, any Paytm-related prompt in Codex will auto-load the skill.

---

## 4. What's inside

Repository structure:

```
.
├── SKILL.md                  # Main instruction file that generates correct Paytm integrations. 
├── references/               # Detailed guides for each product flow
│   ├── js-checkout.md
│   ├── subscriptions.md
│   ├── payment-links.md
│   └── qr-codes.md
└── scripts/                  # Ready to run code samples. Pick your tech stack  
    ├── backend-node/         # Node.js backend example for payment integration  
    ├── backend-spring/       # Java backend example for payment integration  
    ├── backend-python/       # Python backend example for payment integration
    └── frontend/
        ├── checkout.html      # Demo page for Paytm checkout (One Time Payment)
        ├── subscription.html  # Demo page for recurring payment setup
        ├── payment-link.html  # Demo page to create and share payment links with customers
        └── qr.html            # Demo page to display a dynamic UPI QR code for payments
```

---

## 5. Important notes

To go live with Paytm, you will need a **MID** (your unique Merchant ID) and a **Merchant Key** (your secret key) for both staging and production. Each environment has its own pair, staging keys will not work in production and vice versa.

- *Staging (test mode):* https://dashboard.paytmpayments.com/next/apikeys -> Generate now (under Test API Details)
- *Production (Live Mode):* https://dashboard.paytmpayments.com/next/apikeys -> Get Merchant ID, Merchant Key from Production API details.

  (Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding or contact your Paytm KAM.)

Store keys in environment variables. Never commit them or expose them in client-side code.

The reference backends under `scripts/backend-*` are **demos**: permissive CORS, no CSRF / auth on the create endpoints, in-memory idempotency / webhook dedup. Don't copy them into production as-is - add your own auth, swap the in-memory caches for Redis / a DB, and lock down CORS to the origins you actually own.

Only the following payment options are permitted and must be exclusively displayed: UPI, Credit Cards, Debit Cards, Net Banking, and EMI. No other payment options should be included, suggested, or processed under any circumstances.

---

## License

MIT, see [LICENSE](LICENSE).

---

Built and maintained by the Paytm Payments developer team. Issues and PRs welcome.
