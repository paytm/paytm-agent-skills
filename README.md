# Paytm Agent Skills
### For Paytm PG Integration


**Integrate Paytm Payment Gateway in minutes, just by describing what you want to build.**

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-D97757)](https://docs.anthropic.com/en/docs/claude-code/skills)
[![Paytm PG](https://img.shields.io/badge/Paytm-Payment%20Gateway-002970)](https://www.paytmpayments.com/docs)

This repository provides ready-to-use integration skills that allow AI tools (Claude, Codex, Cursor and more) to initiate and manage payments via [Paytm PG](https://www.paytmpayments.com/docs). Just describe your business in plain English, the agent generates production-ready integration code for you.

The skills teach your AI agent the full Paytm spec, integration patterns, and common pitfalls, so the code it generates works on the first try.

---

## 1. Supported Products for Integration

| Product | Description |
|---|---|
| **JS Checkout** | Paytm hosted checkout page for web/app payments |
| **Subscriptions** | Recurring payment collections through UPI Autopay, cards or eNACH |
| **Payment Links** | Generate and share payment links for payment collections |
| **QR Codes** | Display dynamic QR codes on your website for UPI payments |
| **All-in-One SDK** | Native checkout on Android/ iOS, with Paytm-hosted UI |
| **Custom SDK** | Fully branded mobile checkout, your UI on top of the Paytm rails |
| **Webhooks** | Real-time payment notifications delivered to your server |
| **Refunds** | Issue full and partial refund and check refund status |
| **PG Migration** | Migrate to Paytm PG from existing PG |

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

**All-in-One SDK (Android / iOS)**
> *"I sell handmade jewellery from my Android app. I want to integrate Paytm with my app so that my customers can make payments directly inside my app"*

**Custom SDK (Android / iOS)**
> *"I have a shoes business. I sell shoes from my Android app and have my own payment screen. I want to integrate Paytm PG to accept payments from my customers."*

**Refunds**
> *"I run an online clothing store. Sometimes customers return products. Integrate Paytm refunds into my website so that I can make refunds to my customers."*

**PG Migration**
> *"I have payments set up on my book store website. I want to switch to Paytm. Help me migrate my existing payment integration to Paytm PG."*

---

## 3. Setup

```bash
npx paytm-skills install
```

Auto-detects every AI tool on your machine (Claude Code, Codex, Cursor etc.) and installs the skill bundle into each tool in a single command. Re-run any time to upgrade.

### Install using a simple prompt (For Claude Code and Codex Only)

```bash
Install the Paytm PG integration skill globally from https://github.com/paytm/paytm-integration-skills 
```

### Supported AI tools

Most tools install automatically. Four (Claude.ai Projects, Antigravity, VS Code Copilot, GitHub Copilot CLI) don't expose a filesystem skills folder, so you copy the skill files through the tool's own UI / config the installer skips them with a clear message.

| Tool | How it's installed | Where the files land |
|---|---|---|
| Claude Code | `npx paytm-skills install` | `~/.claude/skills/paytm/` |
| Codex | `npx paytm-skills install` | `~/.codex/skills/paytm/` |
| Cursor | `npx paytm-skills install` | `~/.cursor/skills-cursor/paytm/` + `~/.cursor/rules/paytm.mdc` |
| Continue | `npx paytm-skills install` | `~/.continue/rules/paytm/` |
| Windsurf | `npx paytm-skills install` | `~/.codeium/windsurf/memories/paytm.md` (single file) |
| Gemini CLI | `npx paytm-skills install` | `~/.gemini/skills/paytm/` |
| Aider | `npx paytm-skills install` | `~/.config/aider/conventions/paytm.md` (single file) |
| OpenCode | `npx paytm-skills install` | `~/.opencode/skills/paytm/` |

After install:
- **Claude Code:** restart, run `/skills` to verify.
- **Cursor / Continue / Windsurf:** restart the IDE.
- **Codex / Gemini CLI:** new sessions pick up the skill automatically.

---

## 4. What's inside

Skills are **modular** , each prompt loads only the relevant skill, keeping the AI focused and the generated code accurate.

```
.
├── skills/                          # One folder per skill, load only which skill is needed
│   ├── getting-started/             # Details about MID, key, environments, .env file, decision tree
│   ├── js-checkout/                 # Paytm hosted checkout page for One-time payments
│   │   └── references/REFERENCE.md
│   ├── subscriptions/               # Recurring payment collections through UPI Autopay, cards or eNACH
│   │   └── references/REFERENCE.md
│   ├── payment-links/               # Generate and share payment links via SMS or email
│   │   └── references/REFERENCE.md
│   ├── qr-codes/                    # Display dynamic QR codes on your website for UPI payments
│   │   └── references/REFERENCE.md
│   ├── webhooks/                    # Real-time payment notifications delivered to your server
│   │   └── references/REFERENCE.md
│   ├── refunds/                     # Issue full or partial refunds to customers
│   │   └── references/REFERENCE.md
│   ├── all-in-one-sdk/              # Native checkout on Android and iOS, with Paytm-hosted UI
│   │   └── references/REFERENCE.md
│   ├── custom-sdk/                  # Fully branded mobile checkout, your UI on top of the Paytm rails
│   │   └── references/REFERENCE.md
│   ├── troubleshooting/             # Common Paytm PG integration errors and fixes
│   │   └── references/REFERENCE.md
│   ├── migrate-from-razorpay/       # Migrate to Paytm PG from Razorpay
│   │   └── references/REFERENCE.md
│   ├── migrate-from-cashfree/       # Migrate to Paytm PG from Cashfree
│   │   └── references/REFERENCE.md
│   ├── migrate-from-juspay/         # Migrate to Paytm PG from Juspay
│   │   └── references/REFERENCE.md
│   └── migrate-from-payu/           # Migrate to Paytm PG from PayU
│       └── references/REFERENCE.md
└── scripts/                         # Ready to run code samples. Pick your tech stack 
    ├── backend-node/                # Node.js backend example for payment integration
    ├── backend-python/              # Python backend example for payment integration
    ├── backend-spring/              # Java backend example for payment integration (Spring Boot 3)
    ├── backend-spring-legacy/       # Java backend example for payment integration (Spring 5)
    └── frontend/
        ├── checkout.html            # Demo page for Paytm checkout (One Time Payment)
        ├── subscription.html        # Demo page for recurring payment setup
        ├── payment-link.html        # Demo page to create and share payment links with customers
        └── qr.html                  # Demo page to display a dynamic UPI QR code for payments

```

## 5. How Paytm Integration Skill Works

1. You describe what you want to build in plain English, for example, "Integrate Paytm JS Checkout on my website." The skill's decision tree maps your prompt to the right Paytm product automatically.
2. Only the relevant skill loads  asking about JS Checkout loads just the js-checkout skill, not all skills. This keeps the AI focused and makes the generated code more accurate.
3. The skill injects Paytm-specific knowledge into the AI  correct API endpoints, checksum logic, token flows, and common errors so the code it generates works on the first try.
4. Code is generated for your specific tech stack  Node.js, Python, Java using battle-tested reference implementations as the base.
5. Every integration ends with a checklist staging test credentials, webhook setup, and production go-live steps.

---

## 6. Important notes

To go live with Paytm, you will need a **MID** (your unique Merchant ID) and a **Merchant Key** (your secret key) for both staging and production. Each environment has its own pair, staging keys will not work in production and vice versa.

- *Staging (test mode):* https://dashboard.paytmpayments.com/next/apikeys -> Generate now (under Test API Details)
- *Production (Live Mode):* https://dashboard.paytmpayments.com/next/apikeys -> Get Merchant ID, Merchant Key from Production API details.

  (Production keys are issued only after KYC + account activation. If the tab is empty, finish onboarding or contact your Paytm KAM.)

Store keys in environment variables. Never commit them or expose them in client-side code.

---

## License

MIT, see [LICENSE](LICENSE).

---

Built and maintained by the Paytm Payments developer team. Issues and PRs welcome.
