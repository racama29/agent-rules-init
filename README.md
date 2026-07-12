# agent-rules-init

Most AI coding assistants (Claude Code, Codex, Copilot, Cursor) get used as generic chat because configuring them properly — `CLAUDE.md`, `AGENTS.md`, architecture rules, review prompts — is manual work almost nobody does.

`agent-rules-init` generates those files **from what your repo already is**: it reads your manifests (`package.json`, `pyproject.toml`/`environment.yml`, `pom.xml`/`build.gradle(.kts)`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`, `.csproj`, `Package.swift`, `pubspec.yaml`, `CMakeLists.txt`/`Makefile`...), detects the framework, test runner and package manager, and only asks what it cannot infer with confidence.

What sets it apart from asking an assistant to "write me a CLAUDE.md":

- **One command, every assistant** — consistent configuration for Claude Code, Codex, Copilot, Cursor, Gemini CLI and Windsurf at once, including ready-to-use `/review`, `/refactor` and `/testing` commands for each ecosystem.
- **Evidence, not vibes** — commands come from your actual CI workflows and manifests, conventions from your actual config files, each claim with its source cited.
- **AI as an amplifier, with guardrails** — with `claude` or `codex` installed, `--enrich` has your own assistant investigate the code and rewrite the generic sections with verified, repo-specific rules; its output is validated and canonical commands must survive verbatim, or the deterministic version is kept.
- **Never destructive** — everything is written with a `.generated.` suffix; your hand-tuned files are read and integrated, never overwritten.

## Three-step workflow

```text
npx agent-rules-init  →  review *.generated.*  →  npx agent-rules-init --apply
       generate                  inspect                     activate + backup
```

The first command is safe to run in an existing repository: it only creates staging
files. Review the detected commands and evidence, then use `--apply` to activate them.
Run `--force` after tooling or architecture changes to refresh staging, and use
`--check` in CI to detect stale rules. See [Getting started](docs/getting-started.md)
for the shortest complete walkthrough.

## Usage

From the root of your repo:

```bash
npx agent-rules-init
```

The CLI scans the repo, detects the stack(s) present, and generates a set of files **without ever overwriting anything** — everything is created with the `.generated.` suffix:

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- `.cursor/rules/repository.generated.mdc`
- `GEMINI.generated.md`
- `<workspace>/AGENTS.generated.md` for each nested JS/TS package
- `.claude/commands/<stack>-{review,refactor,testing}.generated.md`
- `.github/prompts/<stack>-{review,refactor,testing}.generated.prompt.md`

(`<stack>` is one of the 15 listed below — if your repo mixes several, one set of prompts is generated per stack.)

Windsurf consumes the root `AGENTS.md` directly, so it needs no duplicate vendor-specific file.

Besides per-stack advice, the generated files include **facts extracted from your repo**:

- **Repo commands** — the real build/test/lint commands declared in `package.json` scripts, `composer.json` scripts, `Makefile` targets, `mix.exs` aliases and `tox.ini` envs.
- **Workspace-aware detection** — nested JS/TS packages get path-scoped rules and executable commands for npm, pnpm, Yarn or Bun.
- **Measured detection quality** — CI enforces a rendered corpus contract plus 30 positive/negative scenarios spanning all 15 stacks.
- **Structure** — top-level directories, annotated only when their meaning is unambiguous.
- **What CI runs** — the `run:` steps from your `.github/workflows/*.yml` (read locally; the CLI never touches the network).
- **Observed architecture** — declared entrypoints, test placement, source roots, workspaces and layered layouts, each with file evidence.
- **Verified local conventions** — conservative rules from `.editorconfig`, strict TypeScript settings, Ruff/Black line length and explicit `CONTRIBUTING.md` directives.

The general documents are tailored to their consumer: `CLAUDE.md` keeps repository context and the complete fact catalog, `AGENTS.md` emphasizes operational rules and canonical validation commands, and Copilot instructions stay concise and code-oriented without copying CI or terminal catalogs.

If something cannot be inferred with confidence (e.g. the framework), the CLI asks you one targeted question before generating the files.

**Last step, manual on purpose:** review the generated content and run `npx agent-rules-init --apply`. It activates the reviewed staging files and backs up replaced final files; nothing you hand-tuned is silently lost.

## AI enrichment

If you have `claude` or `codex` installed and authenticated, the CLI can use your own session to **enrich** the generated files. The assistant investigates style configuration, `CONTRIBUTING`, sources and tests, then replaces generic sections with repo-specific, evidence-backed rules.

Enrichment is constrained to read-only operation: Codex runs in its read-only sandbox and an ephemeral session; Claude runs in safe mode with only `Read`, `Glob` and `Grep`. Repository content is still untrusted input, so review generated rules before activating them and avoid enrichment on an untrusted checkout when using an assistant version too old to support these safeguards. Unsupported safety flags fail closed and keep the deterministic output.

- **Interactive runs** offer it with an explicit question — never automatic, and it may take a few minutes.
- **`--enrich`** forces it without asking, also without a TTY, so scripts and onboarding docs can rely on it (`--check` ignores it: freshness comparison needs the deterministic baseline).
- **You control the spend**: `--assistant claude|codex` picks which installed assistant to use, and `--model <id>` is forwarded verbatim to it (e.g. `--model haiku` for a cheaper run) — no model list is hardcoded, so new models work without updating this package. Without these flags it uses the first assistant found and that assistant's own default model.
- **Existing `CLAUDE.md`, `AGENTS.md` or copilot instructions are useful context, but remain untrusted data**: meta-instructions inside them are never authority over the enrichment contract.
- **Guardrails**: the output is validated (same files/order/headings, valid JSON), verified commands must survive verbatim, and new bullet claims need cited evidence. Evidence paths must resolve to regular files inside the repository.
- **Semantic safety**: destructive instructions, prompt-injection language, new Markdown sections and commands not extracted from repository manifests/CI invalidate the batch.
- **Latency control**: successful enrichment is cached using the deterministic baseline, assistant/model, a bounded repository content fingerprint and hashes of every accepted staging file. Any repository edit or staging tamper invalidates it. `--no-enrich-cache` forces a fresh run.
- **Budget control**: `--enrich-timeout <seconds>` and `--enrich-retries <0..2>` bound the worst-case wait. Terminal/JSON metrics report cache hits, changed lines and security rejections as well as batches, characters, fallbacks and elapsed time.

## Options

```bash
npx agent-rules-init             # scan the current directory
npx agent-rules-init --enrich    # additionally, let your installed claude/codex analyze the code and enrich the output
npx agent-rules-init --enrich --assistant codex --model gpt-5.5  # choose the assistant and model (token spend is yours)
npx agent-rules-init --enrich --enrich-timeout 60 --enrich-retries 0  # fast, single-attempt budget
npx agent-rules-init --enrich --no-enrich-cache # deliberately bypass verified cached output
npx agent-rules-init --lang en   # force the content language (es|en); defaults to your system locale
npx agent-rules-init --help      # show help
npx agent-rules-init --version   # show the version
npx agent-rules-init --dry-run  # preview every file without writing
npx agent-rules-init --force    # refresh *.generated.* files, never activated final files
npx agent-rules-init --apply    # activate reviewed staging files, backing up replaced finals
npx agent-rules-init --check    # exit 1 when generated or activated files are missing/outdated
npx agent-rules-init --json     # emit one machine-readable result
npx agent-rules-init --non-interactive # skip questions and the AI-enrichment offer
```

## Repository configuration

Optional settings live in `.agent-rules-init.yml` (or `.yaml`):

```yaml
lang: en
enrich: true
assistant: codex
model: gpt-5.5
enrichCache: true
enrichTimeoutSeconds: 300
enrichRetries: 1
scanMaxDepth: 12
scanMaxFiles: 100000
scanWorkerTimeoutSeconds: 30
exclude:
  - legacy/**
projects:
  apps/web:
    framework: react
    testRunner: vitest
    packageManager: pnpm
```

Project overrides are applied to the package-scoped `AGENTS.generated.md`. Excluded JS/TS packages do not contribute dependencies, commands or scoped output.

The enrichment cache is enabled by default. `enrich`, `assistant`, `model`, `enrichCache`, `enrichTimeoutSeconds` and `enrichRetries` make repeated team invocations reproducible. Explicit CLI flags take precedence. `noAi: true` disables enrichment regardless of those settings.

## Before and after

Without enrichment, a detected Python project receives safe stack-level guidance such as “run the repository test suite before finishing”. With enrichment, a Flask-style repository can receive evidence-backed rules such as:

```md
- Keep imports one per line; Ruff enforces `force-single-line = true`. (evidence: `pyproject.toml`)
- Treat warnings as test failures and fix their source instead of filtering them. (evidence: `pyproject.toml`)
- Keep `sansio/` independent from request and socket I/O. (evidence: `CONTRIBUTING.rst`)
```

The cited paths are checked before the enriched output is accepted. Claims whose cited files do not exist are reported and removed when they are standalone bullets.

## Keeping rules fresh

Run `npx agent-rules-init --force` after meaningful tooling or architecture changes. It replaces only `*.generated.*` staging files. Activated files such as `CLAUDE.md` and `AGENTS.md` are never overwritten.

After reviewing staging, `npx agent-rules-init --apply` promotes exactly those files. Existing active files are copied first to a timestamped `.agent-rules-init/backups/` directory, which contains its own ignore rule. Use `--force --apply` only when you intentionally want to regenerate and activate in one command.

Each complete generation records a git-ignored `.agent-rules-init.generated.json` receipt containing a deterministic baseline fingerprint and hashes of the accepted outputs. `--check` uses it to detect repository changes and validate enriched output without calling the model again. When an activated final file exists it takes precedence over staging, so a current `.generated` file can never hide a stale file that an assistant actually consumes. `--json` exposes `baselineCurrent` and per-file staging/active state for CI diagnostics.

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
npm run check
```

## Contributing

Adding support for a new stack means implementing the `Pack` interface in a file under `packages/cli/src/packs/` — no new npm package needed. See [`docs/writing-a-pack.md`](docs/writing-a-pack.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## En español

`agent-rules-init` genera `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` y prompts de review/refactor/testing a partir del stack detectado en tu repo, más los hechos reales del proyecto (comandos declarados, estructura, lo que ejecuta CI). Todo se crea con sufijo `.generated.` y nunca sobrescribe nada: revisa y usa `--apply` para activar con backup seguro.

Con `claude` o `codex` instalados, `--enrich` (o la pregunta interactiva) hace que tu propio asistente investigue el código y sustituya las secciones genéricas por reglas específicas del repo con evidencia citada; si ya tienes un `CLAUDE.md` o `AGENTS.md` a mano, se integra en el resultado en vez de ignorarse. La salida se valida y, si algo falla, se conserva la versión determinista.

En sistemas con locale en español todo el contenido y los mensajes salen en español automáticamente; usa `--lang es` o `--lang en` para forzar el idioma.

```bash
npx agent-rules-init
```

## License

MIT — see [`LICENSE`](LICENSE).
