# agent-rules-init

This is the publishable CLI package from the
[`agent-rules-init` repository](https://github.com/racama29/agent-rules-init).
The root README is the canonical source for the complete feature, configuration,
security and contribution documentation.

The operating model is intentionally simple: generate staging files, review them,
then activate them with `npx agent-rules-init --apply`. Existing active files are
backed up before replacement.

Generate repository-specific instructions for Claude Code, Codex, GitHub Copilot, Cursor, Gemini CLI and Windsurf from the manifests and commands that already exist in your project.

```bash
npx agent-rules-init
```

The CLI detects JavaScript/TypeScript, Python, Java, PHP, Ruby, Go, Rust, C#/.NET, Kotlin, Swift, Dart/Flutter, C/C++, Elixir, Scala and R projects. It also understands mixed repositories and npm, pnpm, Yarn and Bun workspaces, generating package-scoped `AGENTS.generated.md` files.

All output is written with a `.generated` suffix and existing files are never overwritten during generation. Review them and run `--apply` to activate with safe backups.

Use `--lang es` or `--lang en` to select the output language. See the [full documentation](https://github.com/racama29/agent-rules-init#readme) for supported frameworks, generated files and contribution instructions.

Automation is supported through `--dry-run`, `--force`, `--apply`, `--check`, `--json` and `--non-interactive`. Repository defaults, enrichment assistant/model and per-project overrides can be stored in `.agent-rules-init.yml`.

Use `--apply` after review to activate staging files; replaced finals are backed up under `.agent-rules-init/backups/`.

Complete generations store a git-ignored hash receipt so `--check` can verify deterministic or enriched active files without rerunning an assistant. Activated final files take precedence over staging during checks.

AI enrichment runs assistants with read-only restrictions and falls back to deterministic output when invocation or validation fails. Review generated files before activation, especially when the repository did not come from a trusted source.

Verified enrichment is reused when repository inputs, assistant/model and accepted staging hashes are unchanged. Use `--no-enrich-cache` for a deliberate fresh run, and bound latency with `--enrich-timeout <seconds>` plus `--enrich-retries <0..2>`.

Semantic validation rejects prompt-injection language, new sections, destructive instructions, commands absent from repository facts and evidence paths outside the repository. Metrics report cache hits, changed lines and security rejections in addition to batch, retry, input-size, fallback and duration data.

Generated documents share an evidence-backed model but are not duplicates: Claude receives broad repository context, AGENTS receives operational commands and scope, and Copilot receives concise implementation conventions. Observed architecture and local conventions include their source files so specific claims can be audited.

## License

MIT
