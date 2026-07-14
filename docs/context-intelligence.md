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

## Maintainer context

Repository facts and maintainer intent are deliberately different inputs. Facts are
high-confidence observations with source paths; intent is a human declaration about
purpose, priorities, boundaries and acceptable assistant autonomy. An optional task
adds the goal, success criteria, allowed paths and behavior when an unforeseen choice
appears. The CLI collects these values only through the explicit `--interview` flow or
a validated `--context-file`.

The renderers preserve that distinction with dedicated sections. Claude, Gemini and
AGENTS receive complete operational context; Copilot and Cursor receive a concise
subset. Prompt files include task context when it can personalize the task, even if
the repository has no high-confidence fact for that category. Enrichment must preserve
every maintainer statement verbatim, and rejects a batch that changes or drops one.

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

## Measurable corpus contract

`packages/cli/test/corpus-quality-cases.ts` is the versioned quality contract. Each
fixture declares required and forbidden terms plus the minimum number of evidence-backed
claims. The corpus test also verifies that Claude, AGENTS and Copilot outputs remain
materially different. A release must score 100%; new stacks should add a representative
fixture and quality case instead of relying only on snapshots.

`quality-matrix.test.ts` adds 30 focused detection scenarios: one positive framework
case and one neutral false-positive guard for every supported stack. CI runs both the
rendered corpus and this matrix through `npm run test:quality`.

## Large repositories

The scanner is bounded by `scanMaxDepth` and `scanMaxFiles`. Machine-readable output
includes `scanStats` (`files`, `durationMs`, `truncated`) and `scanWarnings`, making slow
or incomplete discovery visible in CI. Raise a budget deliberately for unusually deep
monorepos; a truncated scan must not be treated as a complete repository inventory.
The published CLI uses the bounded synchronous scanner because process startup is part
of the product latency budget. `scanStats.mode` reports `sync`, while `scanStats.source`
reports `git` or `filesystem`. Git inventory is preferred and filesystem traversal is
the fallback outside a Git worktree.
