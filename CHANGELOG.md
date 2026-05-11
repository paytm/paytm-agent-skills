# Changelog

All notable changes to the `paytm` skills bundle are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [2.0.0] - Unreleased

### BREAKING

- Repository restructured from a **single monolithic skill** to a **bundle of 8 modular skills**. Old install path `~/.claude/skills/paytm-integration/` is replaced by `~/.claude/skills/paytm/` (and the equivalent per-tool dirs). Re-run `npx paytm-skills install --force` to upgrade; remove the old `paytm-integration` dir manually.
- `manifest.json` schema bumped to `manifest_version: "2.0"`. The previous flat `entry` + `references[]` shape is replaced by `skills[]` (each skill carries its own entry + references + triggers + description).
- Adapter format names tightened: `cursor-rules` / `continue-rules` / `windsurf-rules` / `agents-md` collapsed into `skill-md` (multi-file) and `bundled-md` (single concatenated file).

### Added

- **8 modular skills** under `skills/`:
  `getting-started`, `js-checkout`, `subscriptions`, `payment-links`, `qr-codes`, `webhooks`, `refunds` (stub), `troubleshooting`.
- **Routing manifest generation** — `routing/PREAMBLE.md` is the single source of truth for global rules + decision tree. The `lib/adapters/routing.mjs` renderer writes a per-tool routing file at install time (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/paytm.mdc`, `ROUTING.md`). Bundled-md targets (Windsurf, Aider) inline the same preamble at the top of their single file.
- Auto-generated **skill index table** appended to every routing manifest — lists each skill with its trigger keywords.
- Per-tool `target.routing_file` field in the manifest.
- New top-level skill `webhooks` covering S2S receiver, signature verification, and dedup.
- New top-level skill `refunds` (currently a stub — full content lands in the next product-depth release).

### Changed

- `manifest.json` skill-list moved into nested `skills[]`. `manifest.references[]` removed at top level (now per-skill).
- `manifest.schema.json` updated for the new shape with `routing_preamble`, `skills[].triggers`, `skills[].references`, `target.routing_file`.
- `scripts/manifest/validate.mjs` rewritten for v2 — now validates each skill's path / entry / references and cross-checks each `SKILL.md` frontmatter against `manifest.skills[].triggers`.
- `lib/adapters/skill-md.mjs` rewritten for multi-skill — copies all 8 skill folders into one bundle dir, plus a `shared/` folder with assets, plus the per-tool routing manifest.
- `lib/adapters/bundled-md.mjs` rewritten — concatenates routing preamble + every skill's entry + every skill's references + assets into one file (Windsurf, Aider).
- README rewritten — `npx paytm-skills install` is the primary install path; legacy git-clone instructions removed.

### Removed

- `SKILL.md` at repo root (content carved into per-skill files).
- `references/` at repo root (each reference moved to its owning skill's `references/REFERENCE.md`).
- Old format names (`cursor-rules` / `continue-rules` / `windsurf-rules` / `agents-md`) from manifest schema enum.

## [1.0.0] - Earlier

### Added

- `manifest.json` distribution manifest declaring entry, references, assets, backends, triggers, capabilities, and supported AI tool targets.
- `manifest.schema.json` JSON Schema for the manifest.
- `scripts/manifest/validate.mjs` zero-dep validator (runs in CI).
- `bin/cli.mjs` NPX CLI with `install`, `uninstall`, `list-targets`, `path` subcommands.
- `lib/manifest.mjs`, `lib/paths.mjs`, `lib/install.mjs`, `lib/detect.mjs`.
- `lib/adapters/skill-md.mjs` (multi-file copy) and `lib/adapters/bundled-md.mjs` (single concatenated file) adapters.
- GitHub Actions workflows: `manifest` (validator on every PR) and `cli` (cross-OS smoke tests on Ubuntu / macOS / Windows × Node 18 / 20 / 22).
- 9 AI tool targets supported: Claude Code, Claude.ai, Codex (CLI + ChatGPT desktop), Cursor, Continue, Windsurf, Gemini CLI, Antigravity, Aider.
- Asset bundling for `bundled-md` targets — `.env.example` and frontend HTML files inlined as fenced code blocks.
- Auto-detect logic with both directory-presence and PATH-binary checks.
