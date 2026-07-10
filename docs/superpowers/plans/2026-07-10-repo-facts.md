# RepoFacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a los archivos generados secciones con hechos reales del repo: comandos declarados (npm/composer/make/mix/tox), estructura de directorios anotada solo cuando es inequívoca, y comandos que ejecuta CI (GitHub Actions).

**Architecture:** Módulo nuevo `core/repo-facts.ts` con funciones puras `RepoSignals → RepoFacts`, separado de los packs (que no se tocan). El scanner captura tres señales nuevas (workflows, tox.ini, composer scripts). `templates.ts` gana un render de secciones globales que se añade tras las secciones de stack. Spec: `docs/superpowers/specs/2026-07-10-repo-specific-content-design.md`.

**Tech Stack:** TypeScript (ESM, Node), vitest, dependencia nueva `yaml` para parsear workflows.

## Global Constraints

- Regla transversal: **omitir antes que inventar** — entrada ambigua o no parseable ⇒ cero entradas de esa fuente, nunca excepción ni dato especulativo.
- TDD estricto: test rojo antes de cada implementación.
- Los 15 packs (`src/packs/*.ts`) no se modifican.
- Texto generado en español (consistente con el resto del CLI).
- Comandos de test/build: `npm test --workspace=packages/cli -- run <archivo>` y `npm run build --workspaces --if-present` desde la raíz.
- Commits con prefijos convencionales (`feat:`, `test:`...) y footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Mensajes multilínea vía `git commit -F <archivo>` (los here-strings de PowerShell con comillas dobles fallan en este entorno).

---

### Task 1: Señales nuevas en el scanner (tox.ini, workflows, composer scripts)

**Files:**
- Modify: `packages/cli/src/core/types.ts` (interfaces `RepoSignals`, `ComposerJsonManifest`)
- Modify: `packages/cli/src/core/scanner.ts` (capturas nuevas en `scanRepo`)
- Test: `packages/cli/test/scanner.test.ts`

**Interfaces:**
- Consumes: `scanRepo(rootPath)` existente.
- Produces: `RepoSignals.toxIni?: string`, `RepoSignals.githubWorkflows?: { path: string; content: string }[]` (path normalizado con `/`), `ComposerJsonManifest.scripts?: Record<string, unknown>`.

- [ ] **Step 1: Test rojo** — añadir a `scanner.test.ts` (dentro de `describe("scanRepo")`, con el patrón tmpDir ya usado en el archivo):

```typescript
describe("with CI workflows, tox.ini and composer scripts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-facts-"));
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "jobs:\n  test:\n    steps:\n      - run: npm test\n");
    fs.writeFileSync(path.join(tmpDir, "tox.ini"), "[tox]\nenvlist = py311\n");
    fs.writeFileSync(path.join(tmpDir, "composer.json"), JSON.stringify({ require: {}, scripts: { test: "phpunit" } }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures workflow files with normalized paths and raw content", () => {
    const signals = scanRepo(tmpDir);
    expect(signals.githubWorkflows).toHaveLength(1);
    expect(signals.githubWorkflows?.[0].path).toBe(".github/workflows/ci.yml");
    expect(signals.githubWorkflows?.[0].content).toContain("npm test");
  });

  it("captures tox.ini raw content", () => {
    const signals = scanRepo(tmpDir);
    expect(signals.toxIni).toContain("envlist");
  });

  it("captures composer.json scripts", () => {
    const signals = scanRepo(tmpDir);
    expect(signals.composerJson?.scripts).toEqual({ test: "phpunit" });
  });
});
```

- [ ] **Step 2: Verificar rojo** — `npm test --workspace=packages/cli -- run test/scanner.test.ts`. Esperado: 3 FAIL (propiedades `undefined`).

- [ ] **Step 3: Implementación mínima** — en `types.ts`, añadir a `ComposerJsonManifest` el campo `scripts?: Record<string, unknown>;` y a `RepoSignals` (tras `renvLock`):

```typescript
  toxIni?: string;
  githubWorkflows?: { path: string; content: string }[];
```

En `scanner.ts`, dentro de `scanRepo`: al construir `composerJson` añadir `scripts: (rawComposerJson.scripts as Record<string, unknown>) ?? {}`. Tras `renvLockPath`:

```typescript
  const toxIniPath = findFirst(files, "tox.ini");
  const workflowPaths = files.filter((f) => {
    const normalized = f.split(path.sep).join("/");
    return (
      normalized.startsWith(".github/workflows/") &&
      (normalized.endsWith(".yml") || normalized.endsWith(".yaml"))
    );
  });
```

Y en el objeto retornado:

```typescript
    toxIni: toxIniPath ? readTextIfExists(path.join(rootPath, toxIniPath)) : undefined,
    githubWorkflows: workflowPaths
      .map((p) => ({
        path: p.split(path.sep).join("/"),
        content: readTextIfExists(path.join(rootPath, p)),
      }))
      .filter((w): w is { path: string; content: string } => w.content !== undefined),
```

- [ ] **Step 4: Verificar verde** — mismo comando. Esperado: PASS todo `scanner.test.ts`.
- [ ] **Step 5: Commit** — `git add packages/cli/src/core/types.ts packages/cli/src/core/scanner.ts packages/cli/test/scanner.test.ts` + `feat(scanner): capture workflows, tox.ini and composer scripts`.

---

### Task 2: Tipos RepoFacts + extractores npm y composer

**Files:**
- Modify: `packages/cli/src/core/types.ts`
- Create: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts` (nuevo)

**Interfaces:**
- Consumes: `RepoSignals` (con los campos de Task 1).
- Produces (en `types.ts`):

```typescript
export type CommandSource = "npm" | "composer" | "make" | "mix" | "tox";

export interface CommandEntry {
  source: CommandSource;
  invocation: string; // "npm test", "composer lint", "make docs", "mix setup", "tox -e py311"
  detail?: string;    // cuerpo del script cuando es legible (npm/composer)
}

export interface DirEntry {
  dir: string;   // "src/"
  note?: string; // solo si es inequívoco
}

export interface CiCommand {
  command: string;
  workflow: string; // nombre de archivo, p. ej. "ci.yml"
}

export interface RepoFacts {
  commands: CommandEntry[];
  omittedCommands: { source: CommandSource; count: number }[];
  structure: DirEntry[];
  ciCommands: CiCommand[];
  omittedCiCount: number;
}
```

- Produces (en `repo-facts.ts`): `extractNpmCommands(signals): CommandEntry[]`, `extractComposerCommands(signals): CommandEntry[]`.

- [ ] **Step 1: Test rojo** — crear `test/repo-facts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractNpmCommands, extractComposerCommands } from "../src/core/repo-facts.js";
import type { RepoSignals } from "../src/core/types.js";

export function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("extractNpmCommands", () => {
  it("maps scripts to npm run invocations with the script body as detail", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: { lint: "eslint .", test: "vitest run" },
          moduleType: "commonjs",
        },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm run lint", detail: "eslint ." });
  });

  it("uses the direct form for npm lifecycle scripts (test/start)", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { test: "vitest run" }, moduleType: "commonjs" },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest run" });
  });

  it("skips empty script bodies and returns [] without package.json", () => {
    expect(extractNpmCommands(baseSignals({}))).toEqual([]);
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { noop: "   " }, moduleType: "commonjs" },
      })
    );
    expect(entries).toEqual([]);
  });
});

describe("extractComposerCommands", () => {
  it("flattens string and array script values", () => {
    const entries = extractComposerCommands(
      baseSignals({
        composerJson: { require: {}, requireDev: {}, scripts: { test: "phpunit", check: ["phpcs", "phpstan"] } },
      })
    );
    expect(entries).toContainEqual({ source: "composer", invocation: "composer test", detail: "phpunit" });
    expect(entries).toContainEqual({ source: "composer", invocation: "composer check", detail: "phpcs && phpstan" });
  });

  it("skips non-string/non-array values and returns [] without composer.json", () => {
    expect(extractComposerCommands(baseSignals({}))).toEqual([]);
    const entries = extractComposerCommands(
      baseSignals({ composerJson: { require: {}, requireDev: {}, scripts: { weird: { nested: true } } } })
    );
    expect(entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificar rojo** — `npm test --workspace=packages/cli -- run test/repo-facts.test.ts`. Esperado: FAIL por módulo inexistente.
- [ ] **Step 3: Implementación** — añadir los tipos de arriba a `types.ts` y crear `src/core/repo-facts.ts`:

```typescript
import type { CommandEntry, RepoSignals } from "./types.js";

const NPM_DIRECT_LIFECYCLE = new Set(["test", "start", "stop", "restart"]);

export function extractNpmCommands(signals: RepoSignals): CommandEntry[] {
  const scripts = signals.packageJson?.scripts ?? {};
  const entries: CommandEntry[] = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string" || body.trim() === "") continue;
    entries.push({
      source: "npm",
      invocation: NPM_DIRECT_LIFECYCLE.has(name) ? `npm ${name}` : `npm run ${name}`,
      detail: body.trim(),
    });
  }
  return entries;
}

export function extractComposerCommands(signals: RepoSignals): CommandEntry[] {
  const scripts = signals.composerJson?.scripts ?? {};
  const entries: CommandEntry[] = [];
  for (const [name, raw] of Object.entries(scripts)) {
    const parts = Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === "string")
      : typeof raw === "string"
      ? [raw]
      : [];
    if (parts.length === 0) continue;
    entries.push({ source: "composer", invocation: `composer ${name}`, detail: parts.join(" && ") });
  }
  return entries;
}
```

- [ ] **Step 4: Verificar verde** — mismo comando. Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(repo-facts): add RepoFacts types and npm/composer command extractors`.

---

### Task 3: Extractor de targets de Makefile

**Files:**
- Modify: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Produces: `extractMakeTargets(signals): CommandEntry[]` (invocación `make <target>`, sin `detail`).

- [ ] **Step 1: Test rojo**:

```typescript
describe("extractMakeTargets", () => {
  it("extracts top-level targets as make invocations", () => {
    const makefile = "build: deps\n\tgcc -o app main.c\n\ntest:\n\t./run-tests.sh\n";
    const entries = extractMakeTargets(baseSignals({ makefile }));
    expect(entries).toContainEqual({ source: "make", invocation: "make build" });
    expect(entries).toContainEqual({ source: "make", invocation: "make test" });
  });

  it("ignores special targets, pattern rules, variable assignments and recipe lines", () => {
    const makefile = [
      ".PHONY: build",          // target especial
      "%.o: %.c",               // pattern rule
      "CFLAGS := -Wall",        // asignación
      "OUT ?= dist",            // asignación
      "build:",
      "\tdocker build: not-a-target", // línea de receta (tab)
      "# https://example.com: comentario con dos puntos",
    ].join("\n");
    const entries = extractMakeTargets(baseSignals({ makefile }));
    expect(entries).toEqual([{ source: "make", invocation: "make build" }]);
  });

  it("returns [] without a Makefile and deduplicates repeated targets", () => {
    expect(extractMakeTargets(baseSignals({}))).toEqual([]);
    const entries = extractMakeTargets(baseSignals({ makefile: "all: a\nall: b\n" }));
    expect(entries).toEqual([{ source: "make", invocation: "make all" }]);
  });
});
```

- [ ] **Step 2: Verificar rojo** — FAIL: `extractMakeTargets` no existe.
- [ ] **Step 3: Implementación** — en `repo-facts.ts`:

```typescript
export function extractMakeTargets(signals: RepoSignals): CommandEntry[] {
  const makefile = signals.makefile;
  if (!makefile) return [];
  const targets = new Set<string>();
  for (const line of makefile.split(/\r?\n/)) {
    // Un target va a inicio de línea (las recetas van indentadas con tab) y su nombre
    // no lleva %, ni empieza por "." (targets especiales tipo .PHONY). El (?!=) evita
    // asignaciones ":=". La clase de caracteres ya excluye espacios, con lo que
    // "CFLAGS :=" y los comentarios "#" tampoco matchean.
    const match = /^([A-Za-z0-9_/-][A-Za-z0-9_./-]*)\s*:(?!=)/.exec(line);
    if (!match) continue;
    targets.add(match[1]);
  }
  return [...targets].map((target) => ({ source: "make" as const, invocation: `make ${target}` }));
}
```

Nota: el primer carácter de la clase excluye `.` para descartar `.PHONY` y similares; el resto del nombre sí admite puntos (`docs.build:`).

- [ ] **Step 4: Verificar verde.**
- [ ] **Step 5: Commit** — `feat(repo-facts): extract Makefile targets`.

---

### Task 4: Extractores de mix aliases y tox envlist

**Files:**
- Modify: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Produces: `extractMixAliases(signals): CommandEntry[]` (`mix <alias>`), `extractToxEnvs(signals): CommandEntry[]` (`tox -e <env>`).

- [ ] **Step 1: Test rojo**:

```typescript
describe("extractMixAliases", () => {
  it("extracts alias names from a Phoenix-style aliases function", () => {
    const mixExs = `
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      test: ["ecto.create --quiet", "test"]
    ]
  end
`;
    const entries = extractMixAliases(baseSignals({ mixExs }));
    expect(entries).toContainEqual({ source: "mix", invocation: "mix setup" });
    expect(entries).toContainEqual({ source: "mix", invocation: "mix ecto.setup" });
    expect(entries).toContainEqual({ source: "mix", invocation: "mix test" });
  });

  it("returns [] when there is no aliases function or no mix.exs", () => {
    expect(extractMixAliases(baseSignals({}))).toEqual([]);
    expect(extractMixAliases(baseSignals({ mixExs: "defp deps do\n  []\nend\n" }))).toEqual([]);
  });
});

describe("extractToxEnvs", () => {
  it("extracts envs from envlist as tox -e invocations", () => {
    const toxIni = "[tox]\nenvlist = py311, lint\n\n[testenv]\ncommands = pytest\n";
    const entries = extractToxEnvs(baseSignals({ toxIni }));
    expect(entries).toContainEqual({ source: "tox", invocation: "tox -e py311" });
    expect(entries).toContainEqual({ source: "tox", invocation: "tox -e lint" });
  });

  it("skips generator envs ({}) instead of guessing, and returns [] without tox.ini", () => {
    expect(extractToxEnvs(baseSignals({}))).toEqual([]);
    const entries = extractToxEnvs(baseSignals({ toxIni: "[tox]\nenvlist = py3{10,11}, docs\n" }));
    expect(entries).toEqual([{ source: "tox", invocation: "tox -e docs" }]);
  });
});
```

- [ ] **Step 2: Verificar rojo.**
- [ ] **Step 3: Implementación**:

```typescript
export function extractMixAliases(signals: RepoSignals): CommandEntry[] {
  const mixExs = signals.mixExs;
  if (!mixExs) return [];
  // Cuerpo de la función aliases (defp aliases do ... end). Si no existe con esa
  // forma, no se emite nada — omitir antes que inventar.
  const fnMatch = mixExs.match(/defp?\s+aliases\s*(?:\(\))?\s*do([\s\S]*?)\n\s*end/);
  if (!fnMatch) return [];
  const body = fnMatch[1];
  const names = new Set<string>();
  // Claves del keyword list cuyo valor empieza por lista o string: `setup: [...]`,
  // `"ecto.setup": [...]`. Un alias con valor función (&fun/1) se omite.
  for (const match of body.matchAll(/(?:"([^"]+)"|([a-z_][a-zA-Z0-9_.]*)):\s*(?=[\["'])/g)) {
    names.add(match[1] ?? match[2]);
  }
  return [...names].map((alias) => ({ source: "mix" as const, invocation: `mix ${alias}` }));
}

export function extractToxEnvs(signals: RepoSignals): CommandEntry[] {
  const toxIni = signals.toxIni;
  if (!toxIni) return [];
  const match = toxIni.match(/^[ \t]*env_?list\s*=\s*(.+(?:\n[ \t]+\S.*)*)/m);
  if (!match) return [];
  const envs = match[1]
    .split(/[,\s]+/)
    .map((env) => env.trim())
    .filter((env) => env !== "" && !env.startsWith("#") && !env.includes("{"));
  return [...new Set(envs)].map((env) => ({ source: "tox" as const, invocation: `tox -e ${env}` }));
}
```

- [ ] **Step 4: Verificar verde.**
- [ ] **Step 5: Commit** — `feat(repo-facts): extract mix aliases and tox envs`.

---

### Task 5: Filtro anti-ruido y estructura de directorios

**Files:**
- Modify: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Produces: `filterCommands(entries): { kept: CommandEntry[]; omitted: { source: CommandSource; count: number }[] }` y `extractStructure(signals): DirEntry[]`.

- [ ] **Step 1: Test rojo**:

```typescript
describe("filterCommands", () => {
  const mk = (n: number): CommandEntry[] =>
    Array.from({ length: n }, (_, i) => ({ source: "npm" as const, invocation: `npm run task${i}`, detail: "x" }));

  it("keeps everything under the per-source cap and reports nothing omitted", () => {
    const { kept, omitted } = filterCommands(mk(3));
    expect(kept).toHaveLength(3);
    expect(omitted).toEqual([]);
  });

  it("caps at 15 per source, always keeping well-known names, and reports the omitted count", () => {
    const entries = [...mk(20), { source: "npm" as const, invocation: "npm test", detail: "vitest" }];
    const { kept, omitted } = filterCommands(entries);
    expect(kept).toHaveLength(15);
    expect(kept).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest" });
    expect(omitted).toEqual([{ source: "npm", count: 6 }]);
  });

  it("applies the cap per source, not globally", () => {
    const make = Array.from({ length: 10 }, (_, i) => ({ source: "make" as const, invocation: `make t${i}` }));
    const { kept, omitted } = filterCommands([...mk(10), ...make]);
    expect(kept).toHaveLength(20);
    expect(omitted).toEqual([]);
  });
});

describe("extractStructure", () => {
  it("lists top-level dirs sorted, annotating only unequivocal names", () => {
    const files = ["src/index.ts", "src/deep/a.ts", "tests/a.test.ts", "weirddir/x.txt", "README.md"];
    const dirs = extractStructure(baseSignals({ files }));
    expect(dirs).toEqual([
      { dir: "src/", note: "código fuente" },
      { dir: "tests/", note: "tests" },
      { dir: "weirddir/" },
    ]);
  });

  it("caps at 20 dirs and returns [] for a flat repo", () => {
    expect(extractStructure(baseSignals({ files: ["README.md"] }))).toEqual([]);
    const files = Array.from({ length: 30 }, (_, i) => `dir${String(i).padStart(2, "0")}/f.txt`);
    expect(extractStructure(baseSignals({ files }))).toHaveLength(20);
  });
});
```

Nota Windows: `extractStructure` debe normalizar separadores (`\` → `/`) porque `signals.files` usa `path.sep`.

- [ ] **Step 2: Verificar rojo.**
- [ ] **Step 3: Implementación** (imports: añadir `DirEntry`, `CommandSource` al import de types; `import path from "node:path"`):

```typescript
const WELL_KNOWN_NAMES = new Set([
  "test", "tests", "build", "lint", "fmt", "format", "check", "dev", "start",
  "typecheck", "ci", "coverage", "e2e", "unit", "docs", "clean", "install",
  "setup", "release", "watch", "fix", "all",
]);
const MAX_COMMANDS_PER_SOURCE = 15;

function invocationName(entry: CommandEntry): string {
  const parts = entry.invocation.split(" ");
  return parts[parts.length - 1];
}

export function filterCommands(entries: CommandEntry[]): {
  kept: CommandEntry[];
  omitted: { source: CommandSource; count: number }[];
} {
  const kept: CommandEntry[] = [];
  const omitted: { source: CommandSource; count: number }[] = [];
  const sources = [...new Set(entries.map((e) => e.source))];
  for (const source of sources) {
    const group = entries.filter((e) => e.source === source);
    const wellKnown = group.filter((e) => WELL_KNOWN_NAMES.has(invocationName(e)));
    const rest = group.filter((e) => !WELL_KNOWN_NAMES.has(invocationName(e)));
    const keptGroup = [...wellKnown, ...rest].slice(0, MAX_COMMANDS_PER_SOURCE);
    // Reordenar al orden original del manifiesto
    kept.push(...group.filter((e) => keptGroup.includes(e)));
    const omittedCount = group.length - keptGroup.length;
    if (omittedCount > 0) omitted.push({ source, count: omittedCount });
  }
  return { kept, omitted };
}

const DIR_NOTES: Record<string, string> = {
  src: "código fuente",
  lib: "código fuente",
  tests: "tests",
  test: "tests",
  spec: "tests",
  __tests__: "tests",
  docs: "documentación",
  doc: "documentación",
  examples: "ejemplos",
  scripts: "scripts auxiliares",
  tools: "herramientas auxiliares",
  migrations: "migraciones de base de datos",
  benchmarks: "benchmarks",
  ".github": "workflows y configuración de GitHub",
  public: "activos públicos",
  static: "activos estáticos",
  assets: "activos",
  config: "configuración",
};
const MAX_DIRS = 20;

export function extractStructure(signals: RepoSignals): DirEntry[] {
  const dirs = new Set<string>();
  for (const file of signals.files) {
    const normalized = file.split(path.sep).join("/");
    const slash = normalized.indexOf("/");
    if (slash > 0) dirs.add(normalized.slice(0, slash));
  }
  return [...dirs]
    .sort()
    .slice(0, MAX_DIRS)
    .map((dir) => {
      const note = DIR_NOTES[dir.toLowerCase()];
      return note ? { dir: `${dir}/`, note } : { dir: `${dir}/` };
    });
}
```

- [ ] **Step 4: Verificar verde.**
- [ ] **Step 5: Commit** — `feat(repo-facts): add noise filter and directory structure extractor`.

---

### Task 6: Extractor de CI (GitHub Actions) + dependencia `yaml`

**Files:**
- Modify: `packages/cli/package.json` (dependencia `yaml`)
- Modify: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Produces: `extractCiCommands(signals): { commands: CiCommand[]; omittedCount: number }`.

- [ ] **Step 1: Instalar dependencia** — `npm install yaml --workspace=packages/cli`. Verificar que queda en `dependencies` (no dev).
- [ ] **Step 2: Test rojo**:

```typescript
describe("extractCiCommands", () => {
  const wf = (content: string, p = ".github/workflows/ci.yml") =>
    baseSignals({ githubWorkflows: [{ path: p, content }] });

  it("collects run steps line by line, including block scalars", () => {
    const { commands } = extractCiCommands(
      wf("on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: |\n          npm run lint\n          npm test\n")
    );
    expect(commands).toEqual([
      { command: "npm ci", workflow: "ci.yml" },
      { command: "npm run lint", workflow: "ci.yml" },
      { command: "npm test", workflow: "ci.yml" },
    ]);
  });

  it("deduplicates across workflows keeping the first origin, and skips comments/empty lines", () => {
    const signals = baseSignals({
      githubWorkflows: [
        { path: ".github/workflows/a.yml", content: "jobs:\n  j:\n    steps:\n      - run: |\n          # comentario\n\n          npm test\n" },
        { path: ".github/workflows/b.yml", content: "jobs:\n  j:\n    steps:\n      - run: npm test\n" },
      ],
    });
    const { commands } = extractCiCommands(signals);
    expect(commands).toEqual([{ command: "npm test", workflow: "a.yml" }]);
  });

  it("ignores unparseable workflows and workflows without jobs, and returns [] without workflows", () => {
    expect(extractCiCommands(baseSignals({})).commands).toEqual([]);
    expect(extractCiCommands(wf(":: not yaml ::")).commands).toEqual([]);
    expect(extractCiCommands(wf("name: empty\non: push\n")).commands).toEqual([]);
  });

  it("caps at 30 commands and reports the omitted count", () => {
    const runs = Array.from({ length: 35 }, (_, i) => `      - run: echo ${i}`).join("\n");
    const { commands, omittedCount } = extractCiCommands(wf(`jobs:\n  j:\n    steps:\n${runs}\n`));
    expect(commands).toHaveLength(30);
    expect(omittedCount).toBe(5);
  });
});
```

- [ ] **Step 3: Verificar rojo.**
- [ ] **Step 4: Implementación** (import `{ parse } from "yaml"` y `CiCommand` de types):

```typescript
const MAX_CI_COMMANDS = 30;

export function extractCiCommands(signals: RepoSignals): { commands: CiCommand[]; omittedCount: number } {
  const seen = new Map<string, string>(); // comando -> workflow de origen
  for (const workflow of signals.githubWorkflows ?? []) {
    let doc: unknown;
    try {
      doc = parse(workflow.content);
    } catch {
      continue; // YAML inválido: omitir antes que inventar
    }
    if (!doc || typeof doc !== "object") continue;
    const jobs = (doc as Record<string, unknown>).jobs;
    if (!jobs || typeof jobs !== "object") continue;
    const workflowName = workflow.path.split("/").pop() ?? workflow.path;
    for (const job of Object.values(jobs as Record<string, unknown>)) {
      if (!job || typeof job !== "object") continue;
      const steps = (job as Record<string, unknown>).steps;
      if (!Array.isArray(steps)) continue;
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const run = (step as Record<string, unknown>).run;
        if (typeof run !== "string") continue;
        for (const rawLine of run.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (line === "" || line.startsWith("#")) continue;
          if (!seen.has(line)) seen.set(line, workflowName);
        }
      }
    }
  }
  const all = [...seen.entries()].map(([command, workflow]) => ({ command, workflow }));
  return {
    commands: all.slice(0, MAX_CI_COMMANDS),
    omittedCount: Math.max(0, all.length - MAX_CI_COMMANDS),
  };
}
```

- [ ] **Step 5: Verificar verde.**
- [ ] **Step 6: Commit** (incluir `package.json` y `package-lock.json` de la raíz) — `feat(repo-facts): extract CI commands from GitHub Actions workflows`.

---

### Task 7: `buildRepoFacts` (ensamblado)

**Files:**
- Modify: `packages/cli/src/core/repo-facts.ts`
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Produces: `buildRepoFacts(signals): RepoFacts` — única función que consumirán `cli.ts` y los tests de integración.

- [ ] **Step 1: Test rojo**:

```typescript
describe("buildRepoFacts", () => {
  it("assembles commands from every source plus structure and CI", () => {
    const facts = buildRepoFacts(
      baseSignals({
        files: ["src/index.ts", "package.json"],
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { test: "vitest run" }, moduleType: "module" },
        makefile: "docs:\n\tsphinx-build\n",
        githubWorkflows: [{ path: ".github/workflows/ci.yml", content: "jobs:\n  j:\n    steps:\n      - run: npm ci\n" }],
      })
    );
    expect(facts.commands).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest run" });
    expect(facts.commands).toContainEqual({ source: "make", invocation: "make docs" });
    expect(facts.structure).toEqual([{ dir: "src/", note: "código fuente" }]);
    expect(facts.ciCommands).toEqual([{ command: "npm ci", workflow: "ci.yml" }]);
    expect(facts.omittedCommands).toEqual([]);
    expect(facts.omittedCiCount).toBe(0);
  });

  it("returns fully empty facts for an empty repo", () => {
    const facts = buildRepoFacts(baseSignals({}));
    expect(facts).toEqual({ commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0 });
  });
});
```

- [ ] **Step 2: Verificar rojo.**
- [ ] **Step 3: Implementación**:

```typescript
export function buildRepoFacts(signals: RepoSignals): RepoFacts {
  const allCommands = [
    ...extractNpmCommands(signals),
    ...extractComposerCommands(signals),
    ...extractMakeTargets(signals),
    ...extractMixAliases(signals),
    ...extractToxEnvs(signals),
  ];
  const { kept, omitted } = filterCommands(allCommands);
  const { commands: ciCommands, omittedCount: omittedCiCount } = extractCiCommands(signals);
  return {
    commands: kept,
    omittedCommands: omitted,
    structure: extractStructure(signals),
    ciCommands,
    omittedCiCount,
  };
}
```

- [ ] **Step 4: Verificar verde.**
- [ ] **Step 5: Commit** — `feat(repo-facts): assemble RepoFacts from all extractors`.

---

### Task 8: Render de secciones en templates

**Files:**
- Modify: `packages/cli/src/core/templates.ts`
- Test: `packages/cli/test/templates.test.ts`

**Interfaces:**
- Consumes: `RepoFacts` de Task 2/7.
- Produces: `renderRepoFacts(facts): string` (exportada para el fallback de cli.ts) y parámetro opcional nuevo en los tres render: `renderClaudeMd(entries, facts?)`, `renderAgentsMd(entries, facts?)`, `renderCopilotInstructions(entries, facts?)`. Sin `facts` o con facts vacíos, la salida es idéntica a la actual.

- [ ] **Step 1: Test rojo** — añadir a `templates.test.ts` (usar los helpers/fixtures de entries ya presentes en el archivo):

```typescript
import { renderRepoFacts } from "../src/core/templates.js";
import type { RepoFacts } from "../src/core/types.js";

const facts: RepoFacts = {
  commands: [
    { source: "npm", invocation: "npm test", detail: "vitest run --coverage" },
    { source: "make", invocation: "make docs" },
  ],
  omittedCommands: [{ source: "npm", count: 4 }],
  structure: [{ dir: "src/", note: "código fuente" }, { dir: "weirddir/" }],
  ciCommands: [{ command: "npm ci", workflow: "ci.yml" }],
  omittedCiCount: 0,
};

const emptyFacts: RepoFacts = { commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0 };

describe("renderRepoFacts", () => {
  it("renders the three sections with per-line source attribution", () => {
    const output = renderRepoFacts(facts);
    expect(output).toContain("## Comandos del repo");
    expect(output).toContain("- `npm test` → `vitest run --coverage` (package.json)");
    expect(output).toContain("- `make docs` (Makefile)");
    expect(output).toContain("…y 4 más en package.json");
    expect(output).toContain("## Estructura");
    expect(output).toContain("- `src/` — código fuente");
    expect(output).toContain("- `weirddir/`");
    expect(output).toContain("## Lo que ejecuta CI (GitHub Actions)");
    expect(output).toContain("- `npm ci` (ci.yml)");
  });

  it("omits every empty section and returns empty string for empty facts", () => {
    expect(renderRepoFacts(emptyFacts)).toBe("");
    const onlyStructure = { ...emptyFacts, structure: [{ dir: "src/" }] };
    const output = renderRepoFacts(onlyStructure);
    expect(output).toContain("## Estructura");
    expect(output).not.toContain("## Comandos del repo");
    expect(output).not.toContain("## Lo que ejecuta CI");
  });
});

describe("render entry points with facts", () => {
  it("appends the facts sections after the stack sections in CLAUDE.md", () => {
    const output = renderClaudeMd(entries, facts); // `entries` = fixture existente del archivo
    expect(output.indexOf("## Comandos del repo")).toBeGreaterThan(output.indexOf("### Convenciones"));
  });

  it("keeps output identical to today when facts are omitted or empty", () => {
    expect(renderClaudeMd(entries)).toBe(renderClaudeMd(entries, emptyFacts));
  });
});
```

- [ ] **Step 2: Verificar rojo.**
- [ ] **Step 3: Implementación** — en `templates.ts` (import `CommandSource`, `RepoFacts` de types):

```typescript
const SOURCE_FILES: Record<CommandSource, string> = {
  npm: "package.json",
  composer: "composer.json",
  make: "Makefile",
  mix: "mix.exs",
  tox: "tox.ini",
};

export function renderRepoFacts(facts: RepoFacts): string {
  const sections: string[] = [];
  if (facts.commands.length > 0) {
    const lines = facts.commands.map((c) =>
      c.detail && c.detail !== c.invocation
        ? `- \`${c.invocation}\` → \`${c.detail}\` (${SOURCE_FILES[c.source]})`
        : `- \`${c.invocation}\` (${SOURCE_FILES[c.source]})`
    );
    for (const o of facts.omittedCommands) lines.push(`- …y ${o.count} más en ${SOURCE_FILES[o.source]}`);
    sections.push(["## Comandos del repo", "", ...lines].join("\n"));
  }
  if (facts.structure.length > 0) {
    const lines = facts.structure.map((d) => (d.note ? `- \`${d.dir}\` — ${d.note}` : `- \`${d.dir}\``));
    sections.push(["## Estructura", "", ...lines].join("\n"));
  }
  if (facts.ciCommands.length > 0) {
    const lines = facts.ciCommands.map((c) => `- \`${c.command}\` (${c.workflow})`);
    if (facts.omittedCiCount > 0) lines.push(`- …y ${facts.omittedCiCount} más`);
    sections.push(["## Lo que ejecuta CI (GitHub Actions)", "", ...lines].join("\n"));
  }
  return sections.join("\n\n");
}
```

Y en cada uno de los tres render (`renderClaudeMd`, `renderAgentsMd`, `renderCopilotInstructions`), cambiar la firma a `(entries: RenderEntry[], facts?: RepoFacts)` y el cuerpo a (ejemplo para CLAUDE, los otros dos igual con su título):

```typescript
export function renderClaudeMd(entries: RenderEntry[], facts?: RepoFacts): string {
  const factsBlock = facts ? renderRepoFacts(facts) : "";
  return [
    "# CLAUDE.md",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
    ...(factsBlock ? ["", factsBlock] : []),
  ].join("\n");
}
```

- [ ] **Step 4: Verificar verde** — también `templates.test.ts` completo (los tests existentes no deben romperse).
- [ ] **Step 5: Commit** — `feat(templates): render repo facts sections`.

---

### Task 9: Cableado en cli.ts + e2e

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `buildRepoFacts` (Task 7), `renderRepoFacts` y renders con `facts` (Task 8).

- [ ] **Step 1: Test rojo** — añadir a `cli.test.ts` (el `beforeEach` ya crea `tmpDir` con package.json react+vitest):

```typescript
it("includes repo facts sections (commands, structure, CI) in the generated files", async () => {
  fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    steps:\n      - run: npm ci\n"
  );
  fs.mkdirSync(path.join(tmpDir, "src"));
  fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.3.0" }, devDependencies: { vitest: "^2.1.0" }, scripts: { test: "vitest run" } })
  );

  const promptFn = vi.fn().mockResolvedValue("");
  await runCli(tmpDir, { promptFn, skipLlm: true });

  const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
  expect(claudeMd).toContain("## Comandos del repo");
  expect(claudeMd).toContain("- `npm test` → `vitest run` (package.json)");
  expect(claudeMd).toContain("- `src/` — código fuente");
  expect(claudeMd).toContain("- `npm ci` (ci.yml)");
  const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8");
  expect(agentsMd).toContain("## Comandos del repo");
});

it("includes repo facts in the fallback file when no stack is detected", async () => {
  fs.rmSync(path.join(tmpDir, "package.json"));
  fs.writeFileSync(path.join(tmpDir, "Makefile"), "build:\n\tgcc main.c\n"); // ojo: make sin señales C no dispara el pack cpp… usar un Makefile no-C:
  fs.writeFileSync(path.join(tmpDir, "Makefile"), "deploy:\n\trsync -a site/ server:/var/www\n");
  const promptFn = vi.fn().mockResolvedValue("");
  await runCli(tmpDir, { promptFn, skipLlm: true });
  const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
  expect(claudeMd).toContain("No se detectó ningún stack conocido");
  expect(claudeMd).toContain("- `make deploy` (Makefile)");
});
```

(El segundo `writeFileSync` del Makefile pisa al primero a propósito: el fixture final debe ser un Makefile sin tokens de compilador para que el pack cpp no detecte y se ejerza el fallback. Eliminar la línea del comentario al escribir el test.)

- [ ] **Step 2: Verificar rojo.**
- [ ] **Step 3: Implementación** — en `cli.ts`: `import { buildRepoFacts } from "./core/repo-facts.js";` e `import { renderRepoFacts, ... }`. Tras `const detections = applyAnswers(...)`:

```typescript
  const facts = buildRepoFacts(signals);
```

Pasar `facts` a los tres render. En el fallback:

```typescript
  } else {
    const factsBlock = renderRepoFacts(facts);
    files.push({
      path: "CLAUDE.generated.md",
      content:
        "# CLAUDE.md\n\nNo se detectó ningún stack conocido. Completa este archivo manualmente.\n" +
        (factsBlock ? `\n${factsBlock}\n` : ""),
    });
  }
```

- [ ] **Step 4: Verificar verde** — suite completa: `npm test --workspaces --if-present`. Esperado: todo PASS.
- [ ] **Step 5: Commit** — `feat(cli): include repo facts in generated files`.

---

### Task 10: Verificación end-to-end contra repos reales

**Files:** ninguno (verificación manual, estilo DEVNOTES).

- [ ] **Step 1: Build** — `npm run build --workspaces --if-present`.
- [ ] **Step 2: Repo sintético local** — crear un repo temporal (fuera del proyecto) con package.json+scripts, workflow y src/, ejecutar `node <ruta-absoluta>/packages/cli/dist/bin.js`, y leer el CLAUDE.generated.md comprobando las tres secciones.
- [ ] **Step 3: Repos reales** — `git clone --depth=1` a carpeta temporal (nunca dentro del proyecto) de al menos: `expressjs/express` (npm scripts + workflows), `pallets/flask` (tox? workflows y docs/Makefile — comprobar que el Makefile de docs no mete targets de Sphinx como comandos del repo raíz… si el Makefile está en docs/ el scanner igualmente lo captura vía findFirst: verificar el resultado y decidir si hay que excluir non-project dirs como en Python), `guzzle/guzzle` (composer scripts), `phoenixframework/phoenix` (mix aliases). Ejecutar el binario en cada uno y revisar el generado a mano buscando datos inventados o ruido.
- [ ] **Step 4:** si aparece un falso positivo, fix + test de regresión + rebuild + re-ejecución (metodología DEVNOTES).
- [ ] **Step 5: Commit final** si hubo fixes; borrar los clones temporales.
