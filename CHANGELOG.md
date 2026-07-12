# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-07-12

### Added

- Safe `--force` refreshes for `*.generated.*` staging files.
- Safe `--apply` activation with timestamped backups of replaced final files.
- Persistent `enrich`, `assistant` and `model` repository settings.
- Read-only assistant isolation for AI enrichment.
- Enrichment cost metrics, large-input warnings, destructive-instruction rejection and clearer old-CLI fallback diagnostics.
- Cursor MDC and Gemini CLI project-context output; Windsurf uses the generated root `AGENTS.md`.
- Automated npm publication for version tags.

### Changed

- `--check` also accepts activated final files after the `.generated` suffix is removed.
- `--check` prioritizes activated files, verifies enriched output through a hash receipt and detects repository-baseline changes.
- Root Vitest discovery is limited to the package's own tests and ignores fixtures.

## [0.5.0] - 2026-07-12

### Added

- Repository-aware AI enrichment through Claude Code and Codex.
- Canonical-command, JSON-contract and cited-evidence guardrails.
- `--enrich`, `--assistant`, `--model`, `--check`, `--dry-run` and JSON automation.
- CI coverage for Node.js 18, 20 and 22 on Linux, macOS and Windows.

[Unreleased]: https://github.com/racama29/agent-rules-init/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/racama29/agent-rules-init/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/racama29/agent-rules-init/releases/tag/v0.5.0
