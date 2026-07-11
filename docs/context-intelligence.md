# Context intelligence and consumer-specific output

`agent-rules-init` turns local repository signals into short facts. A specific claim is rendered only when it has high-confidence evidence; otherwise it is omitted.

## Evidence model

Architecture facts currently cover declared entrypoints, test placement, `src/` or `lib/` source roots, nested JavaScript/TypeScript packages, and controller/service/repository layouts when all three layers are present.

Local conventions are extracted conservatively from:

- `.editorconfig`: unambiguous indentation and final-newline settings;
- `tsconfig.json`: explicit `strict: true`;
- `pyproject.toml`: Ruff or Black line length;
- `CONTRIBUTING.md`: at most five short, explicit bullet directives.

Every fact stores its statement, evidence files, scope and confidence. `--json` exposes the same model used by the renderers.

## Consumer contracts

- `CLAUDE.md` provides broad project context, declared commands, structure, CI and evidence-backed facts.
- `AGENTS.md` prioritizes operational rules, canonical validation commands, scope and observed constraints.
- Copilot instructions contain implementation conventions and observed architecture, without copying command catalogs or CI operations.

## Updating quality snapshots

Changes to extraction or rendering intentionally affect the corpus. Review the diff first, then update snapshots with:

```bash
cd packages/cli
npx vitest run test/corpus.test.ts -u
```

Snapshot updates should preserve source attribution, omit low-confidence claims and keep the three consumer documents materially different.
