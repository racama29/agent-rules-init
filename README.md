# agent-rules-init

Most AI coding assistants (Claude Code, Codex, Copilot, Cursor) get used as generic chat because configuring them properly — `CLAUDE.md`, `AGENTS.md`, architecture rules, review prompts — is manual work almost nobody does.

`agent-rules-init` generates those files **from what your repo already is**: it reads your manifests (`package.json`, `pyproject.toml`/`environment.yml`, `pom.xml`/`build.gradle(.kts)`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`, `.csproj`, `Package.swift`, `pubspec.yaml`, `CMakeLists.txt`/`Makefile`...), detects the framework, test runner and package manager, and only asks what it cannot infer with confidence.

What sets it apart from asking an assistant to "write me a CLAUDE.md":

- **One command, every assistant** — consistent configuration for Claude Code, Codex and Copilot at once, including ready-to-use `/review`, `/refactor` and `/testing` commands for each ecosystem.
- **Evidence, not vibes** — commands come from your actual CI workflows and manifests, conventions from your actual config files, each claim with its source cited.
- **AI as an amplifier, with guardrails** — with `claude` or `codex` installed, `--enrich` has your own assistant investigate the code and rewrite the generic sections with verified, repo-specific rules; its output is validated and canonical commands must survive verbatim, or the deterministic version is kept.
- **Never destructive** — everything is written with a `.generated.` suffix; your hand-tuned files are read and integrated, never overwritten.

## Usage

From the root of your repo:

```bash
npx agent-rules-init
```

The CLI scans the repo, detects the stack(s) present, and generates a set of files **without ever overwriting anything** — everything is created with the `.generated.` suffix:

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- `<workspace>/AGENTS.generated.md` for each nested JS/TS package
- `.claude/commands/<stack>-{review,refactor,testing}.generated.md`
- `.github/prompts/<stack>-{review,refactor,testing}.generated.prompt.md`

(`<stack>` is one of the 15 listed below — if your repo mixes several, one set of prompts is generated per stack.)

Besides per-stack advice, the generated files include **facts extracted from your repo**:

- **Repo commands** — the real build/test/lint commands declared in `package.json` scripts, `composer.json` scripts, `Makefile` targets, `mix.exs` aliases and `tox.ini` envs.
- **Workspace-aware detection** — nested JS/TS packages get path-scoped rules and executable commands for npm, pnpm, Yarn or Bun.
- **Structure** — top-level directories, annotated only when their meaning is unambiguous.
- **What CI runs** — the `run:` steps from your `.github/workflows/*.yml` (read locally; the CLI never touches the network).
- **Observed architecture** — declared entrypoints, test placement, source roots, workspaces and layered layouts, each with file evidence.
- **Verified local conventions** — conservative rules from `.editorconfig`, strict TypeScript settings, Ruff/Black line length and explicit `CONTRIBUTING.md` directives.

The general documents are tailored to their consumer: `CLAUDE.md` keeps repository context and the complete fact catalog, `AGENTS.md` emphasizes operational rules and canonical validation commands, and Copilot instructions stay concise and code-oriented without copying CI or terminal catalogs.

If something cannot be inferred with confidence (e.g. the framework), the CLI asks you one targeted question before generating the files.

**Last step, manual on purpose:** review the generated content and, once you are happy with it, drop the `.generated` suffix (`CLAUDE.generated.md` → `CLAUDE.md`, etc.) — AI assistants only read the final name. This is intentional: nothing you hand-tuned ever gets silently overwritten.

## AI enrichment

If you have `claude` or `codex` installed and authenticated, the CLI can use your own session to **enrich** the generated files: the assistant is launched at the repo root (`claude -p` / `codex exec -`), investigates the actual code (style configuration, `CONTRIBUTING`, sources and tests) and replaces the generic sections with repo-specific, evidence-backed rules.

- **Interactive runs** offer it with an explicit question — never automatic, and it may take a few minutes.
- **`--enrich`** forces it without asking, also without a TTY, so scripts and onboarding docs can rely on it (`--check` ignores it: freshness comparison needs the deterministic baseline).
- **You control the spend**: `--assistant claude|codex` picks which installed assistant to use, and `--model <id>` is forwarded verbatim to it (e.g. `--model haiku` for a cheaper run) — no model list is hardcoded, so new models work without updating this package. Without these flags it uses the first assistant found and that assistant's own default model.
- **Existing `CLAUDE.md`, `AGENTS.md` or copilot instructions are respected**: they are handed to the assistant as the team's intent, to integrate — not contradict — in the enriched output.
- **Guardrails**: the output is validated (same files, same order, valid JSON) and every canonical command must survive verbatim; any batch that fails validation falls back to the deterministic version. Cited evidence is checked too: claims citing files that don't exist in the repo are dropped and reported.

## Options

```bash
npx agent-rules-init             # scan the current directory
npx agent-rules-init --enrich    # additionally, let your installed claude/codex analyze the code and enrich the output
npx agent-rules-init --enrich --assistant codex --model gpt-5.5  # choose the assistant and model (token spend is yours)
npx agent-rules-init --lang en   # force the content language (es|en); defaults to your system locale
npx agent-rules-init --help      # show help
npx agent-rules-init --version   # show the version
npx agent-rules-init --dry-run  # preview every file without writing
npx agent-rules-init --check    # exit 1 when generated files are missing or outdated
npx agent-rules-init --json     # emit one machine-readable result
npx agent-rules-init --non-interactive # skip questions and the AI-enrichment offer
```

## Repository configuration

Optional settings live in `.agent-rules-init.yml` (or `.yaml`):

```yaml
lang: en
noAi: true
exclude:
  - legacy/**
projects:
  apps/web:
    framework: react
    testRunner: vitest
    packageManager: pnpm
```

Project overrides are applied to the package-scoped `AGENTS.generated.md`. Excluded JS/TS packages do not contribute dependencies, commands or scoped output.

All generated content and CLI messages are available in **English and Spanish**. By default the language is detected from your system locale (`es-*` → Spanish, anything else → English).

## Supported stacks

| Stack | Detected frameworks | Status |
|---|---|---|
| JavaScript / TypeScript | React, Next.js, Vue, Angular, Svelte, Express, NestJS, Fastify, Koa | ✅ stable |
| Python | FastAPI, Django, Flask (pip, uv, Poetry or Conda via `environment.yml`) | ✅ stable |
| Java | Spring (Maven or Gradle) | ✅ stable |
| PHP | Laravel, Symfony, CodeIgniter | ✅ stable |
| Ruby | Rails, Sinatra | ✅ stable |
| Go | Gin, Echo, Fiber, Chi | ✅ stable |
| Rust | Actix Web, Axum, Rocket | ✅ stable |
| C# / .NET | ASP.NET Core | ✅ stable |
| Kotlin | Ktor, Android, Spring | ✅ stable |
| Swift | Vapor | ✅ stable |
| Dart / Flutter | Flutter, Shelf | ✅ stable |
| C / C++ | Qt, Boost, SDL2 | ✅ stable |
| Elixir | Phoenix | ✅ stable |
| Scala | Play, Akka | ✅ stable |
| R | Shiny, Plumber | ✅ stable |

## Local development

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Contributing

Adding support for a new stack means implementing the `Pack` interface in a file under `packages/cli/src/packs/` — no new npm package needed. See [`docs/writing-a-pack.md`](docs/writing-a-pack.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## En español

`agent-rules-init` genera `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` y prompts de review/refactor/testing a partir del stack detectado en tu repo, más los hechos reales del proyecto (comandos declarados, estructura, lo que ejecuta CI). Todo se crea con sufijo `.generated.` y nunca sobrescribe nada: revisa y quita el sufijo para activar.

Con `claude` o `codex` instalados, `--enrich` (o la pregunta interactiva) hace que tu propio asistente investigue el código y sustituya las secciones genéricas por reglas específicas del repo con evidencia citada; si ya tienes un `CLAUDE.md` o `AGENTS.md` a mano, se integra en el resultado en vez de ignorarse. La salida se valida y, si algo falla, se conserva la versión determinista.

En sistemas con locale en español todo el contenido y los mensajes salen en español automáticamente; usa `--lang es` o `--lang en` para forzar el idioma.

```bash
npx agent-rules-init
```

## License

MIT — see [`LICENSE`](LICENSE).
