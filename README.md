# agent-rules-init

Most AI coding assistants (Claude Code, Codex, Copilot, Cursor) get used as generic chat because configuring them properly — `CLAUDE.md`, `AGENTS.md`, architecture rules, review prompts — is manual work almost nobody does.

`agent-rules-init` generates those files **from what your repo already is**: it reads your manifests (`package.json`, `pyproject.toml`/`environment.yml`, `pom.xml`/`build.gradle(.kts)`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`, `.csproj`, `Package.swift`, `pubspec.yaml`, `CMakeLists.txt`/`Makefile`...), detects the framework, test runner and package manager, and only asks what it cannot infer with confidence.

## Usage

From the root of your repo:

```bash
npx agent-rules-init
```

The CLI scans the repo, detects the stack(s) present, and generates a set of files **without ever overwriting anything** — everything is created with the `.generated.` suffix:

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- `.claude/commands/<stack>-{review,refactor,testing}.generated.md`
- `.github/prompts/<stack>-{review,refactor,testing}.generated.prompt.md`

(`<stack>` is one of the 15 listed below — if your repo mixes several, one set of prompts is generated per stack.)

Besides per-stack advice, the generated files include **facts extracted from your repo**:

- **Repo commands** — the real build/test/lint commands declared in `package.json` scripts, `composer.json` scripts, `Makefile` targets, `mix.exs` aliases and `tox.ini` envs.
- **Structure** — top-level directories, annotated only when their meaning is unambiguous.
- **What CI runs** — the `run:` steps from your `.github/workflows/*.yml` (read locally; the CLI never touches the network).

If something cannot be inferred with confidence (e.g. the framework), the CLI asks you one targeted question before generating the files.

**Last step, manual on purpose:** review the generated content and, once you are happy with it, drop the `.generated` suffix (`CLAUDE.generated.md` → `CLAUDE.md`, etc.) — AI assistants only read the final name. This is intentional: nothing you hand-tuned ever gets silently overwritten.

If you have `claude` or `codex` installed and authenticated, the CLI offers (optional, never automatic) to use your own session to polish the final wording.

## Options

```bash
npx agent-rules-init             # scan the current directory
npx agent-rules-init --lang en   # force the content language (es|en); defaults to your system locale
npx agent-rules-init --help      # show help
npx agent-rules-init --version   # show the version
```

All generated content and CLI messages are available in **English and Spanish**. By default the language is detected from your system locale (`es-*` → Spanish, anything else → English).

## Supported stacks

| Stack | Detected frameworks | Status |
|---|---|---|
| JavaScript / TypeScript | React, Next.js, Vue, Angular, Svelte, Express, NestJS, Fastify, Koa | ✅ stable |
| Python | FastAPI, Django, Flask (pip, Poetry or Conda via `environment.yml`) | ✅ stable |
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

En sistemas con locale en español todo el contenido y los mensajes salen en español automáticamente; usa `--lang es` o `--lang en` para forzar el idioma.

```bash
npx agent-rules-init
```

## License

MIT — see [`LICENSE`](LICENSE).
