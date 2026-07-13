# Generated files and their purpose

`agent-rules-init` stages consumer-specific files. They are not title-only copies: each format has a deliberately different information budget.

| Output | Consumer | Purpose |
| --- | --- | --- |
| `CLAUDE.generated.md` | Claude Code | Full repository context: stack defaults, commands, structure, CI and observed facts. |
| `AGENTS.generated.md` | Codex and compatible agents | Operational editing rules, canonical validation commands and verified local facts. |
| `.github/copilot-instructions.generated.md` | GitHub Copilot | Concise code-completion guidance; excludes terminal command catalogs. |
| `.cursor/rules/repository.generated.mdc` | Cursor | Always-applied, short editing rules plus canonical validation commands. |
| `GEMINI.generated.md` | Gemini CLI | Investigation and implementation context, including the repository fact catalog. |
| `.claude/commands/<stack>-*.generated.md` | Claude Code | Task prompts generated only when repository evidence can specialize them. |
| `.github/prompts/<stack>-*.generated.prompt.md` | VS Code / Copilot | The same evidence-backed task prompts in prompt-file format. |

Task prompts are intentionally omitted when the scanner cannot support them with a canonical command or an observed architecture/convention fact. Fewer generated files is the correct result when evidence is scarce.
