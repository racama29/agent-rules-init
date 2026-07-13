# ADR 0001: Evidence-first deterministic core

- Status: accepted
- Date: 2026-07-13

## Context

The original MVP offered interactive questions for uncertain metadata and described
all generated guidance as repository-derived. The implementation later became
conservative and non-interactive, while stack packs continued to contribute useful but
generic defaults. AI enrichment could also be enabled from repository configuration.
Those behaviors made the implementation and product story disagree.

## Decision

The deterministic core is the product. It omits uncertain facts, distinguishes local
observations from stack defaults, writes staging only, and performs no assistant
detection or invocation unless the user supplies `--enrich` in that invocation.

Interactive metadata questions are removed. Generic advice is allowed only as a small,
explicitly labeled stack-default section. Repository-specific claims require evidence.

## Consequences

- Normal invocations are reproducible in terminals and automation.
- Sparse repositories may receive sparse output; this is intentional.
- Existing documentation and compatibility types for questions are removed.
- Repository configuration may select enrichment settings but cannot initiate it.
- Packs require positive and negative corpus evidence before receiving stable status.
