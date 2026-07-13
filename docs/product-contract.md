# Product contract

`agent-rules-init` generates short, auditable assistant instructions from local
repository evidence. Precision and predictable behavior take priority over producing
more text.

## Invariants

1. A normal run is local, deterministic and non-interactive.
2. Missing or low-confidence metadata is omitted; it is never invented or requested.
3. Repository observations include their evidence and use only high-confidence facts.
4. Stack defaults are labeled separately and are never presented as observations.
5. Generation writes staging files only and never changes active instructions.
6. `--apply` is the only activation path; replacement is explicit and preceded by a backup.
7. AI enrichment runs only when the invocation contains `--enrich`.
8. Every generated file has a documented consumer and every generated prompt contains
   repository-specific information.
9. A stack is called stable only after positive and negative corpus validation.
10. The published tarball is the exact artifact verified by CI.

## Observable guarantees

| Guarantee | Verification |
|---|---|
| Normal generation starts no assistant process | CLI tests with a rejecting process mock |
| Observed claims always cite evidence | Corpus content-quality gate |
| Low-confidence facts are omitted | Renderer and pack tests |
| Active files survive generation | Writer tests |
| Activation creates backups | Activation tests |
| Enrichment is explicit | CLI option and configuration tests |
| Commands have provenance | Corpus and canonical-command tests |
| Package budgets remain bounded | `scripts/check-package-size.mjs` |
| Startup and 10k-file scan stay bounded | `scripts/benchmark.mjs` |

## Non-goals

- Guessing project conventions from language popularity.
- Replacing human review before activation.
- Executing repository commands or project code.
- Hiding assistant/network use behind repository configuration.
- Supporting rare cases through configuration that weakens predictable defaults.

## Release rule

A release is not ready because the implementation looks complete. It is ready only
when documentation matches this contract, the corpus and full test matrix pass, the
GitHub release workflow is green, and npm provenance can be verified.
