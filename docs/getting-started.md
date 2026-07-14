# Getting started

## 1. Generate staging files

Run this from the repository root:

```bash
npx agent-rules-init
```

The generator inspects local manifests, CI and configuration without making network
requests. `npx` itself may download the package when it is not already cached. The
generator creates only `*.generated.*` staging files and does not replace active
assistant instructions.

## 2. Review what was detected

Check the generated documents before activation. In particular, verify:

- canonical test, lint and build commands;
- detected workspaces, source roots and test directories;
- evidence paths attached to repository-specific claims;
- framework detection in repositories with unusual layouts.

Use `--dry-run` for a terminal preview or `--json` for automation.

## 3. Activate with backups

```bash
npx agent-rules-init --apply
```

Active files such as `AGENTS.md` and `CLAUDE.md` are backed up before replacement.
Backups live under `.agent-rules-init/backups/`.

## Keep instructions current

```bash
npx agent-rules-init --force
npx agent-rules-init --apply
```

Use `npx agent-rules-init --check` in CI. It exits with status 1 when generated or
active files no longer match the repository baseline.

## Optional enrichment

```bash
npx agent-rules-init --enrich --assistant codex
```

Enrichment uses an installed, authenticated assistant in read-only mode. The
deterministic output remains the fallback if the assistant is unavailable, outdated,
returns invalid content or fails a security check.

For large monorepos, configure `scanMaxDepth` and `scanMaxFiles` and inspect
`scanStats`/`scanWarnings` in JSON output.

## Add the maintainer's intent

When stack detection is not enough, run the explicit interview from a terminal:

```bash
npx agent-rules-init --interview
```

It writes permanent project intent to `.agent-rules-init.yml` and can optionally
save the current task to the ignored `.agent-rules-init/task-context.local.yml`.
Use `--context-file ./team-context.yml` to provide validated YAML context without
modifying the repository. Review the generated maintainer sections alongside the
evidence sections before `--apply`. Never put secrets in the context file because
its statements are copied into generated assistant rules.
