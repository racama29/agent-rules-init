# agent-rules-init

La mayoría de asistentes de IA (Claude Code, Codex, Copilot, Cursor) se usan como chat genérico porque configurarlos bien — `CLAUDE.md`, `AGENTS.md`, reglas de arquitectura, prompts de review — es trabajo manual que casi nadie hace.

`agent-rules-init` genera esos archivos **a partir de lo que tu repo ya es**: lee tus manifiestos (`package.json`, `pyproject.toml`/`environment.yml`, `pom.xml`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`, `.csproj`...), detecta framework, test runner y gestor de dependencias, y solo pregunta lo que no puede inferir con confianza.

## Uso

Desde la raíz de tu repo:

```bash
npx agent-rules-init
```

El CLI escanea el repo, detecta el/los stack(s) presentes leyendo tus manifiestos, y genera un conjunto de archivos **sin sobrescribir nunca nada existente** — todo se crea con el sufijo `.generated.`:

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- `.claude/commands/<stack>-{review,refactor,testing}.generated.md`
- `.github/prompts/<stack>-{review,refactor,testing}.generated.prompt.md`

(`<stack>` es `js-ts`, `python`, `java`, `php`, `ruby`, `go`, `rust` o `csharp` — si tu repo mezcla varios, se genera un juego de prompts por cada uno).

Si algún dato no se puede inferir con confianza (p. ej. el framework), el CLI te hará una pregunta puntual antes de generar los archivos.

**Último paso, manual a propósito:** revisa el contenido generado y, cuando estés conforme, quita el sufijo `.generated` del nombre (`CLAUDE.generated.md` → `CLAUDE.md`, etc.) — los asistentes de IA solo leen el nombre final, no el generado. Esto es intencional: así nunca se sobrescribe silenciosamente algo que ya tenías afinado a mano.

Si tienes `claude` o `codex` instalados y autenticados, el CLI te ofrece (opcional, nunca automático) usar tu propia sesión para pulir la redacción final.

## Stacks soportados

| Stack | Frameworks detectados | Estado |
|---|---|---|
| JavaScript / TypeScript | React, Next.js, Vue, Angular, Svelte, Express, NestJS, Fastify, Koa | ✅ estable |
| Python | FastAPI, Django, Flask (pip, Poetry o Conda vía `environment.yml`) | ✅ estable |
| Java | Spring (Maven o Gradle) | ✅ estable |
| PHP | Laravel, Symfony, CodeIgniter | ✅ estable |
| Ruby | Rails, Sinatra | ✅ estable |
| Go | Gin, Echo, Fiber, Chi | ✅ estable |
| Rust | Actix Web, Axum, Rocket | ✅ estable |
| C# / .NET | ASP.NET Core | ✅ estable |

## Desarrollo local

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Contribuir

Añadir soporte a un stack nuevo es implementar la interfaz `Pack` en un archivo dentro de `packages/cli/src/packs/` — no hace falta crear ni publicar ningún paquete npm nuevo. Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) y [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia

MIT — ver [`LICENSE`](LICENSE).
