# Changelog

All notable changes to the `paytm-integration` skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [1.0.0] - Unreleased

### Added
- `manifest.json` distribution manifest declaring entry, references, assets, backends, triggers, capabilities, and supported AI tool targets.
- `manifest.schema.json` JSON Schema for the manifest.
- `scripts/manifest/validate.mjs` zero-dep validator (runs in CI).
- GitHub Actions workflow `manifest` to enforce manifest validity on every PR.

### Notes
- This is the first versioned release of the skill content. The `version` field in `manifest.json` is the canonical version going forward; future changes will bump it according to SemVer.
