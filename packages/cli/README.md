# agent-rules-init

Generate repository-specific instructions for Claude Code, Codex and GitHub Copilot from the manifests and commands that already exist in your project.

```bash
npx agent-rules-init
```

The CLI detects JavaScript/TypeScript, Python, Java, PHP, Ruby, Go, Rust, C#/.NET, Kotlin, Swift, Dart/Flutter, C/C++, Elixir, Scala and R projects. It also understands mixed repositories and npm, pnpm, Yarn and Bun workspaces, generating package-scoped `AGENTS.generated.md` files.

All output is written with a `.generated` suffix and existing files are never overwritten. Review the generated files and remove the suffix when you are ready to activate them.

Use `--lang es` or `--lang en` to select the output language. See the [full documentation](https://github.com/racama29/agent-rules-init#readme) for supported frameworks, generated files and contribution instructions.

Automation is supported through `--dry-run`, `--check`, `--json` and `--non-interactive`. Repository defaults and per-project overrides can be stored in `.agent-rules-init.yml`.

Generated documents share an evidence-backed model but are not duplicates: Claude receives broad repository context, AGENTS receives operational commands and scope, and Copilot receives concise implementation conventions. Observed architecture and local conventions include their source files so specific claims can be audited.

## License

MIT
