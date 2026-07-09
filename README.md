# agent-rules-init

La mayoría de asistentes de IA (Claude Code, Codex, Copilot, Cursor) se usan como chat genérico porque configurarlos bien — `CLAUDE.md`, `AGENTS.md`, reglas de arquitectura, prompts de review — es trabajo manual que casi nadie hace.

`agent-rules-init` genera esos archivos **a partir de lo que tu repo ya es**: lee tus manifiestos (`package.json`, `pyproject.toml`, `pom.xml`, `composer.json`...), detecta framework, test runner y gestor de dependencias, y solo pregunta lo que no puede inferir con confianza.

## Uso

```bash
npx agent-rules-init
```

Esto genera, sin sobrescribir nunca nada existente:

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- `.claude/commands/{review,refactor,testing}.generated.md`
- `.github/prompts/{review,refactor,testing}.generated.prompt.md`

Si tienes `claude` o `codex` instalados y autenticados, el CLI te ofrece (opcional, nunca automático) usar tu propia sesión para pulir la redacción final.

## Stacks soportados

| Stack | Estado |
|---|---|
| JavaScript / TypeScript | ✅ estable |
| Python | ✅ estable |
| Java | ✅ estable |
| PHP | ✅ estable |

## Desarrollo local

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Contribuir

Añadir soporte a un stack nuevo es implementar la interfaz `Pack` en `packages/packs/`. Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) y [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia

MIT — ver [`LICENSE`](LICENSE).
