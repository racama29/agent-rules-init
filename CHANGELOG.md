# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-07-12

### Added

- Verified enrichment cache keyed by repository content, deterministic baseline, assistant/model and accepted output hashes.
- Configurable per-attempt timeout and retry budget through CLI flags and repository configuration.
- Enrichment change metrics for cache hits, changed files/lines and semantic-security rejections.
- Worker-thread repository scanning with bounded depth/files, timeout, fallback diagnostics and JSON performance metrics.
- Versioned content-quality corpus plus 30 positive/negative detection scenarios covering all 15 supported stacks.
- Published-package smoke testing, coverage thresholds, ESLint, dependency auditing and automated dependency updates.
- Safe three-step onboarding documentation for generating, reviewing and activating rules.

### Changed

- Split pack registration, existing-document loading and CLI option parsing into focused modules.
- Tightened Python and Java framework detection to avoid similarly named dependency and project false positives.
- Raised CI coverage requirements to 90% lines, 85% branches and 82% functions.

### Security

- Reject prompt-injection language, unverified commands and new Markdown sections in assistant output.
- Treat existing instruction documents as delimited untrusted data and reject evidence paths outside the repository or through symlinks.
- Preserve bounded assistant stderr and turn unsupported flags, authentication failures and network failures into actionable diagnostics.

## [0.6.2] - 2026-07-12

### Changed

- Unknown frameworks and tooling are now handled conservatively without asking users to identify metadata they may not know.

## [0.6.1] - 2026-07-12

### Fixed

- Published the complete verified build after the earlier `0.6.0` registry artifact was found to predate its release tag and omit `--apply`.
- Enrichment retries now include the validation failure so assistants can correct the exact contract violation.
- The external enrichment smoke test now reports the assistant's fallback diagnostic.

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

[Unreleased]: https://github.com/racama29/agent-rules-init/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/racama29/agent-rules-init/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/racama29/agent-rules-init/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/racama29/agent-rules-init/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/racama29/agent-rules-init/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/racama29/agent-rules-init/releases/tag/v0.5.0
