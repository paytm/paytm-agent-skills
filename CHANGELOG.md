# Changelog

All notable changes to the `paytm` skills bundle are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [0.0.3]

### Changed

- `large-payment-collection`: corrected the vanproxy Create VAN response field to `van` (not `vanId`) with a normalize-on-read warning, and added a "Non-Checkout flow — frontend form pattern" section to `references/REFERENCE.md`.
- `large-payment-collection/SKILL.md`: added the `van` normalization note to quirk #1 and a new quirk #11 (never wire the Create VAN button as a form submit).

### Added

- `scripts/frontend/lpc-non-checkout.html` — reference frontend template for the Non-Checkout flow (`type="button"` handler, inline status, loading state, only `identificationNo` required).

## [0.0.1] - Unreleased

Initial pre-release of the Paytm Agent Skills bundle and `paytm-agent-skills` CLI installer.

### Bundle

- **10 modular skills** under `skills/`:
  `getting-started`, `js-checkout`, `subscriptions`, `payment-links`, `qr-codes`, `webhooks`, `refunds`, `all-in-one-sdk`, `custom-sdk`, `troubleshooting`.
- Each skill ships an `SKILL.md` (always-loaded entry) and optionally a `references/REFERENCE.md` deep dive.
- `routing/PREAMBLE.md` is the single source of truth for global rules (decision tree, terminology, credentials block, test creds).
- Per-framework routing manifest (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/paytm.mdc`, `ROUTING.md`) auto-generated at install time from `routing/PREAMBLE.md` + an auto-generated skill index table. Never edited by hand.

### CLI (`paytm-agent-skills`)

- `npx paytm-agent-skills` launches a branded interactive installer (Paytm Payments theme, auto-detects AI tools, prompts for target / skill selection / backends / force).
- `npx paytm-agent-skills add skills` alias for the interactive flow.
- Scripted commands: `install`, `uninstall`, `list-targets`, `list-skills`, `path`, `help`, `--version`.
- Flags: `--target <id>`, `--all-targets`, `--skill <name>` (repeatable), `--with-backends`, `--force`, `--dry-run`.
- 9 AI tool targets supported: Claude Code, Claude.ai (Projects), Codex (CLI + ChatGPT desktop), Cursor, Continue, Windsurf, Gemini CLI, Antigravity, Aider.
- Two adapter formats: `skill-md` (multi-file folder copy) and `bundled-md` (single concatenated file for memory-bound targets like Windsurf and Aider).
- Auto-detection uses both directory presence and PATH-binary checks.
- Zero runtime dependencies (Node built-ins only).

### Reference implementations

- `scripts/backend-{node,python,spring,spring-legacy}/` — full backends in Node.js, Python, Spring Boot 3 (Jakarta), and Spring legacy (javax.servlet). Each includes idempotency wrapper + S2S webhook receiver.
- `scripts/frontend/{checkout,subscription,payment-link,qr}.html` — copy-paste browser pages.

### Tooling

- `manifest.json` — canonical distribution manifest (10 skills, 9 targets, telemetry stub, migrations array, capabilities).
- `manifest.schema.json` — JSON Schema for the manifest, autocompletion + editor validation.
- `scripts/manifest/validate.mjs` — zero-dep validator (checks required fields, semver, file existence, target uniqueness, cross-checks SKILL.md frontmatter triggers against manifest.skills[].triggers).
- `.github/workflows/manifest.yml` — CI runs validator on every PR.
- `.github/workflows/cli.yml` — cross-OS CI smoke tests (Ubuntu / macOS / Windows × Node 18 / 20 / 22, install + uninstall round-trip).
- `assets/.env.example` — canonical `.env` template shipped alongside the skill bundle.
