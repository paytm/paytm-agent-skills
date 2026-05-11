# Paytm Integration Skills

**Integrate Paytm Payment Gateway in minutes, just by describing what you want to build.**

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-D97757)](https://docs.anthropic.com/en/docs/claude-code/skills)
[![Paytm PG](https://img.shields.io/badge/Paytm-Payment%20Gateway-002970)](https://www.paytmpayments.com/docs)

This repository provides ready-to-use integration skills that allow LLM-powered agents (Claude, Codex, Cursor, Continue, Windsurf, Gemini CLI, Aider, and more) to initiate and manage payments via [Paytm PG](https://www.paytmpayments.com/docs). Just describe your business in plain English, the agent generates production-ready integration code for you.

The skills teach your AI agent the full Paytm spec, integration patterns, and common pitfalls, so the code it generates works on the first try.

---

## 1. Supported Products

| Product | Description |
|---|---|
| **JS Checkout** | Paytm hosted checkout page for web/app payments |
| **Subscriptions** | Recurring payment collections through UPI Autopay, cards or eNACH |
| **Payment Links** | Generate and share payment links for payment collections |
| **QR Codes** | Display dynamic QR codes on your website for UPI payments |
| **Webhooks** | S2S notification receiver with signature verification + dedup |
| **Refunds** | Full and partial refund APIs |

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

One command installs the right files into the AI tool(s) you actually have on your machine.

### Quick install (recommended)

```bash
npx paytm-skills install
```

The installer auto-detects which AI tools are present (Claude Code, Codex, Cursor, Windsurf, etc.) and installs the right files into the right places. Re-run any time to upgrade.

### Pick a specific tool

```bash
npx paytm-skills install --target claude-code
npx paytm-skills install --target codex
npx paytm-skills install --target cursor
```

### Install everywhere

```bash
npx paytm-skills install --all-targets
```

### Other commands

```bash
npx paytm-skills list-targets       # see every supported AI tool + detection state
npx paytm-skills install --dry-run  # preview without writing
npx paytm-skills uninstall          # remove from auto-detected tools
npx paytm-skills --version
npx paytm-skills help
```

### Supported AI tools

| Tool | Installs to | Routing file |
|---|---|---|
| Claude Code | `~/.claude/skills/paytm/` | `CLAUDE.md` |
| Claude.ai (Projects) | manual upload | n/a |
| Codex (CLI or ChatGPT desktop) | `~/.codex/skills/paytm/` | `AGENTS.md` |
| Cursor | `~/.cursor/skills-cursor/paytm/` | `.cursor/rules/paytm.mdc` |
| Continue | `~/.continue/rules/paytm/` | `ROUTING.md` |
| Windsurf | `~/.codeium/windsurf/memories/paytm.md` (single bundled file) | inlined |
| Gemini CLI | `~/.gemini/skills/paytm/` | `GEMINI.md` |
| Antigravity | manual upload | n/a |
| Aider | `~/.config/aider/conventions/paytm.md` (single bundled file) | inlined |

After install:
- **Claude Code:** restart, run `/skills` to verify.
- **Cursor / Continue / Windsurf:** restart the IDE.
- **Codex / Gemini CLI:** new sessions pick up the skill automatically.

---

## 4. What's inside

Skills are **modular** — eight focused skills load only the context relevant to the user's prompt.

```
.
├── skills/                      # One folder per skill - load only what's needed
│   ├── getting-started/         # MID/key, environments, .env conventions, decision tree
│   ├── js-checkout/             # One-time payments + JS Checkout
│   │   └── references/REFERENCE.md
│   ├── subscriptions/           # UPI Autopay / NATIVE_SUBSCRIPTION
│   │   └── references/REFERENCE.md
│   ├── payment-links/           # /link/* APIs
│   │   └── references/REFERENCE.md
│   ├── qr-codes/                # Dynamic QR
│   │   └── references/REFERENCE.md
│   ├── webhooks/                # S2S receiver + signature verification + dedup
│   ├── refunds/                 # Full + partial refunds (stub - expanded soon)
│   └── troubleshooting/         # Symptom -> cause -> fix tree
│       └── references/REFERENCE.md
└── scripts/                     # Reference backends + frontend examples
    ├── backend-node/            # Node.js (Express + paytmchecksum)
    ├── backend-python/          # Python (Flask + paytmchecksum)
    ├── backend-spring/          # Spring Boot 3 + Jakarta + executable JAR
    ├── backend-spring-legacy/   # Spring 5 + javax.servlet + WAR (Tomcat 9)
    └── frontend/
        ├── checkout.html        # JS Checkout (one-time payment)
        ├── subscription.html    # Recurring payment setup
        ├── payment-link.html    # Create and share payment links
        └── qr.html              # Dynamic UPI QR
```

### How modular skills help

When a user asks *"how do I send a payment link via SMS?"*, only the `payment-links` skill content is loaded — not the full 144 KB of every flow. Smaller context per request = better LLM accuracy and faster responses.

---

## 5. Important notes

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
