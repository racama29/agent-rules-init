# agent-rules-init MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `agent-rules-init` CLI: a `npx`-invokable tool that scans a repo, detects stack(s) via a pack-based plugin system (JS/TS, Python, Java, PHP), and generates `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, and review/refactor/testing prompt files — deriving content from what it detects, falling back to interactive questions for anything it can't infer with confidence, with an optional LLM-polish step that shells out to the user's own authenticated `claude` or `codex` CLI.

**Architecture:** npm-workspaces monorepo. `packages/cli` holds the orchestration core (`scanner`, `prompt-engine`, `llm-bridge`, `writer`, `templates`) plus the `Pack` interface. `packages/packs/*` each implement `Pack` for one stack. The CLI composes signals → detections → rules → rendered files, never overwriting existing user files (always `*.generated.*`).

**Tech Stack:** Node.js, TypeScript, Vitest (tests), `@clack/prompts` (interactive CLI questions), npm workspaces, GitHub Actions (CI).

## Global Constraints

- Every generated file uses the `.generated.` infix (e.g. `CLAUDE.generated.md`) and existing files are never overwritten (per spec §"Manejo de conflictos").
- Detection is superficial and homogeneous across all four stacks in the MVP — manifest-file based only, no deep config parsing (per spec §"Contrato de packs").
- `DetectionResult` fields carry a `confidence: "high" | "low"` per field; only `"low"` confidence fields are asked about interactively.
- The whole repo (core + all four packs) is MIT-licensed and published together — no premium/private packs (per spec §"Publicación").
- A failure in one pack, one file write, or the LLM bridge must never abort the whole run — degrade with a warning and continue (per spec §"Manejo de errores").
- LLM polishing is opt-in via an explicit prompt — never invoked automatically.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`

**Interfaces:**
- Produces: root workspace config that `packages/cli` and `packages/packs/*` (Tasks 4-7) plug into via `npm workspaces`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "agent-rules-init-monorepo",
  "private": true,
  "workspaces": [
    "packages/cli",
    "packages/packs/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.generated.*
!fixtures/**/*.generated.*
```

- [ ] **Step 4: Create `.nvmrc`**

```
20
```

- [ ] **Step 5: Create `packages/cli/package.json`**

```json
{
  "name": "agent-rules-init",
  "version": "0.1.0",
  "description": "Generates CLAUDE.md, AGENTS.md, copilot-instructions.md and prompt files from what your repo actually is.",
  "license": "MIT",
  "type": "module",
  "bin": {
    "agent-rules-init": "dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "agent-rules-pack-js-ts": "0.1.0",
    "agent-rules-pack-python": "0.1.0",
    "agent-rules-pack-java": "0.1.0",
    "agent-rules-pack-php": "0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 6: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `packages/cli/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 8: Install dependencies and verify workspace resolves**

Run: `npm install`
Expected: completes without error, creates root `node_modules/` and `package-lock.json`.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .nvmrc packages/cli/package.json packages/cli/tsconfig.json packages/cli/vitest.config.ts package-lock.json
git commit -m "chore: scaffold npm workspaces monorepo for agent-rules-init"
```

---

### Task 2: Core types and the `Pack` contract

**Files:**
- Create: `packages/cli/src/core/types.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `RepoSignals`, `Confidence`, `DetectionField<T>`, `DetectionResult`, `RuleSet`, `PromptTemplate`, `Pack` — imported by every task from Task 3 onward.

- [ ] **Step 1: Write `packages/cli/src/core/types.ts`**

```typescript
export interface PackageJsonManifest {
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export interface ComposerJsonManifest {
  require: Record<string, string>;
  requireDev: Record<string, string>;
}

export interface RepoSignals {
  rootPath: string;
  files: string[];
  hasFile: (relativePath: string) => boolean;
  hasDir: (relativeDir: string) => boolean;
  packageJson?: PackageJsonManifest;
  pyprojectToml?: string;
  requirementsTxt?: string;
  pomXml?: string;
  buildGradle?: string;
  composerJson?: ComposerJsonManifest;
}

export type Confidence = "high" | "low";

export interface DetectionField<T> {
  value: T;
  confidence: Confidence;
}

export interface DetectionResult {
  packId: string;
  language: string;
  framework?: DetectionField<string>;
  packageManager?: DetectionField<string>;
  testRunner?: DetectionField<string>;
  linter?: DetectionField<string>;
}

export interface RuleSet {
  summary: string;
  conventions: string[];
  architectureNotes: string[];
}

export interface PromptTemplate {
  id: "review" | "refactor" | "testing";
  title: string;
  body: string;
}

export interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;
  promptTemplates(detection: DetectionResult): PromptTemplate[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/cli && npx tsc -p tsconfig.json --noEmit`
Expected: no errors (no consumers yet, so this only checks syntax).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/core/types.ts
git commit -m "feat(cli): define RepoSignals, DetectionResult and Pack contract"
```

---

### Task 3: Scanner

**Files:**
- Create: `packages/cli/src/core/scanner.ts`
- Test: `packages/cli/test/scanner.test.ts`
- Create fixtures: `fixtures/node-react-vitest/package.json`, `fixtures/python-fastapi/pyproject.toml`, `fixtures/monorepo-js-python/package.json`, `fixtures/monorepo-js-python/backend/requirements.txt`

**Interfaces:**
- Consumes: `RepoSignals`, `PackageJsonManifest`, `ComposerJsonManifest` from Task 2.
- Produces: `scanRepo(rootPath: string): RepoSignals`, used by Task 12 (CLI orchestration) and indirectly by every pack's `detect()`.

- [ ] **Step 1: Create fixture `fixtures/node-react-vitest/package.json`**

```json
{
  "name": "fixture-node-react-vitest",
  "dependencies": { "react": "^18.3.0" },
  "devDependencies": { "vitest": "^2.1.0", "eslint": "^9.0.0" },
  "scripts": { "test": "vitest run" }
}
```

- [ ] **Step 2: Create fixture `fixtures/python-fastapi/pyproject.toml`**

```toml
[project]
name = "fixture-python-fastapi"
dependencies = ["fastapi", "pytest"]
```

- [ ] **Step 3: Create fixture `fixtures/monorepo-js-python/package.json`**

```json
{
  "name": "fixture-monorepo-root",
  "dependencies": { "vue": "^3.4.0" },
  "devDependencies": { "jest": "^29.7.0" },
  "scripts": {}
}
```

- [ ] **Step 4: Create fixture `fixtures/monorepo-js-python/backend/requirements.txt`**

```
fastapi==0.115.0
pytest==8.3.0
```

- [ ] **Step 5: Write the failing test `packages/cli/test/scanner.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanRepo } from "../src/core/scanner.js";

const fixturesRoot = path.resolve(__dirname, "../../../fixtures");

describe("scanRepo", () => {
  it("reads package.json dependencies for a JS/TS repo", () => {
    const signals = scanRepo(path.join(fixturesRoot, "node-react-vitest"));
    expect(signals.packageJson?.dependencies.react).toBe("^18.3.0");
    expect(signals.packageJson?.devDependencies.vitest).toBe("^2.1.0");
  });

  it("reads pyproject.toml raw content for a Python repo", () => {
    const signals = scanRepo(path.join(fixturesRoot, "python-fastapi"));
    expect(signals.pyprojectToml).toContain("fastapi");
  });

  it("hasFile and hasDir report presence correctly", () => {
    const signals = scanRepo(path.join(fixturesRoot, "node-react-vitest"));
    expect(signals.hasFile("package.json")).toBe(true);
    expect(signals.hasFile("does-not-exist.json")).toBe(false);
  });

  it("finds nested manifests in a monorepo (requirements.txt under backend/)", () => {
    const signals = scanRepo(path.join(fixturesRoot, "monorepo-js-python"));
    expect(signals.packageJson?.dependencies.vue).toBe("^3.4.0");
    expect(signals.requirementsTxt).toContain("fastapi");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/scanner.test.ts`
Expected: FAIL — `Cannot find module '../src/core/scanner.js'`

- [ ] **Step 7: Implement `packages/cli/src/core/scanner.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import type { RepoSignals, PackageJsonManifest, ComposerJsonManifest } from "./types.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);
const MAX_DEPTH = 4;

function walk(rootPath: string): string[] {
  const results: string[] = [];
  function recurse(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        recurse(path.join(dir, entry.name), depth + 1);
      } else {
        results.push(path.relative(rootPath, path.join(dir, entry.name)));
      }
    }
  }
  recurse(rootPath, 0);
  return results;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

function readTextIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf-8");
}

function findFirst(files: string[], fileName: string): string | undefined {
  return files.find((f) => path.basename(f) === fileName);
}

export function scanRepo(rootPath: string): RepoSignals {
  const files = walk(rootPath);
  const fileSet = new Set(files.map((f) => f.split(path.sep).join("/")));

  const packageJsonPath = findFirst(files, "package.json");
  const rawPackageJson = packageJsonPath
    ? readJsonIfExists(path.join(rootPath, packageJsonPath))
    : undefined;
  const packageJson: PackageJsonManifest | undefined = rawPackageJson
    ? {
        name: rawPackageJson.name as string | undefined,
        dependencies: (rawPackageJson.dependencies as Record<string, string>) ?? {},
        devDependencies: (rawPackageJson.devDependencies as Record<string, string>) ?? {},
        scripts: (rawPackageJson.scripts as Record<string, string>) ?? {},
      }
    : undefined;

  const composerJsonPath = findFirst(files, "composer.json");
  const rawComposerJson = composerJsonPath
    ? readJsonIfExists(path.join(rootPath, composerJsonPath))
    : undefined;
  const composerJson: ComposerJsonManifest | undefined = rawComposerJson
    ? {
        require: (rawComposerJson.require as Record<string, string>) ?? {},
        requireDev: (rawComposerJson["require-dev"] as Record<string, string>) ?? {},
      }
    : undefined;

  const pyprojectPath = findFirst(files, "pyproject.toml");
  const requirementsPath = findFirst(files, "requirements.txt");
  const pomPath = findFirst(files, "pom.xml");
  const buildGradlePath = findFirst(files, "build.gradle") ?? findFirst(files, "build.gradle.kts");

  return {
    rootPath,
    files,
    hasFile: (relativePath: string) => fileSet.has(relativePath.split(path.sep).join("/")),
    hasDir: (relativeDir: string) =>
      fs.existsSync(path.join(rootPath, relativeDir)) &&
      fs.statSync(path.join(rootPath, relativeDir)).isDirectory(),
    packageJson,
    pyprojectToml: pyprojectPath ? readTextIfExists(path.join(rootPath, pyprojectPath)) : undefined,
    requirementsTxt: requirementsPath
      ? readTextIfExists(path.join(rootPath, requirementsPath))
      : undefined,
    pomXml: pomPath ? readTextIfExists(path.join(rootPath, pomPath)) : undefined,
    buildGradle: buildGradlePath ? readTextIfExists(path.join(rootPath, buildGradlePath)) : undefined,
    composerJson,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/scanner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/core/scanner.ts packages/cli/test/scanner.test.ts fixtures/
git commit -m "feat(cli): implement repo scanner with fixtures"
```

---

### Task 4: Pack — JS/TS

**Files:**
- Create: `packages/packs/pack-js-ts/package.json`
- Create: `packages/packs/pack-js-ts/tsconfig.json`
- Create: `packages/packs/pack-js-ts/src/index.ts`
- Test: `packages/packs/pack-js-ts/test/index.test.ts`

**Interfaces:**
- Consumes: `RepoSignals`, `Pack`, `DetectionResult`, `RuleSet`, `PromptTemplate` from Task 2.
- Produces: `jsTsPack: Pack` with `id: "js-ts"`, consumed by Task 12 (CLI orchestration).

- [ ] **Step 1: Create `packages/packs/pack-js-ts/package.json`**

```json
{
  "name": "agent-rules-pack-js-ts",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/packs/pack-js-ts/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `packages/packs/pack-js-ts/test/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { jsTsPack } from "../src/index.js";
import type { RepoSignals } from "../../../cli/src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return {
    rootPath: "/fake",
    files: [],
    hasFile: () => false,
    hasDir: () => false,
    ...overrides,
  };
}

describe("jsTsPack", () => {
  it("returns null when there is no package.json", () => {
    expect(jsTsPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects React + Vitest with high confidence", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "react", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "vitest", confidence: "high" });
  });

  it("marks framework as low confidence when no known framework dependency is found", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
      })
    );
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces rules mentioning the detected framework", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
        },
      })
    )!;
    const rules = jsTsPack.rules(detection);
    expect(rules.summary).toContain("react");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = jsTsPack.detect(
      baseSignals({ packageJson: { dependencies: {}, devDependencies: {}, scripts: {} } })
    )!;
    const templates = jsTsPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/packs/pack-js-ts && npx vitest run`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 5: Implement `packages/packs/pack-js-ts/src/index.ts`**

```typescript
import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../../../cli/src/core/types.js";

const FRAMEWORKS: Record<string, string> = {
  react: "react",
  vue: "vue",
  "@angular/core": "angular",
  next: "next",
  svelte: "svelte",
};

const TEST_RUNNERS: Record<string, string> = {
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
};

const LINTERS: Record<string, string> = {
  eslint: "eslint",
  biome: "biome",
};

function detectFromDeps(
  deps: Record<string, string>,
  table: Record<string, string>
): DetectionField<string> | undefined {
  for (const [depName, label] of Object.entries(table)) {
    if (deps[depName]) return { value: label, confidence: "high" };
  }
  return undefined;
}

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.packageJson) return null;
  const allDeps = { ...signals.packageJson.dependencies, ...signals.packageJson.devDependencies };

  const framework = detectFromDeps(allDeps, FRAMEWORKS) ?? {
    value: "none",
    confidence: "low" as const,
  };
  const testRunner = detectFromDeps(allDeps, TEST_RUNNERS) ?? {
    value: "unknown",
    confidence: "low" as const,
  };
  const linter = detectFromDeps(allDeps, LINTERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.hasFile("pnpm-lock.yaml")
    ? { value: "pnpm", confidence: "high" }
    : signals.hasFile("yarn.lock")
    ? { value: "yarn", confidence: "high" }
    : signals.hasFile("package-lock.json")
    ? { value: "npm", confidence: "high" }
    : { value: "npm", confidence: "low" };

  return { packId: "js-ts", language: "TypeScript/JavaScript", framework, testRunner, linter, packageManager };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  const testRunner = detection.testRunner?.value ?? "unknown";
  return {
    summary: `Proyecto JavaScript/TypeScript${framework !== "none" ? ` con ${framework}` : ""}.`,
    conventions: [
      "Usa TypeScript estricto; evita `any` salvo justificación explícita.",
      `Ejecuta los tests con ${testRunner === "unknown" ? "el test runner del proyecto" : testRunner} antes de dar por terminada una tarea.`,
      "Sigue el estilo de módulos ES existente (import/export), no mezcles con require().",
    ],
    architectureNotes: [
      "Mantén los componentes/módulos pequeños y con una responsabilidad clara.",
      "Coloca los tests junto al código que prueban o en un directorio `test/` espejo, según lo que ya use el repo.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (JS/TS)",
      body: `Revisa el diff actual buscando bugs de tipado, condiciones de carrera en async/await, y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (JS/TS)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable. Respeta los tipos existentes.`,
    },
    {
      id: "testing",
      title: "Testing (JS/TS)",
      body: `Escribe tests para el código señalado usando el test runner detectado (${detection.testRunner?.value ?? "el del proyecto"}). Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const jsTsPack: Pack = { id: "js-ts", detect, rules, promptTemplates };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/packs/pack-js-ts && npx vitest run`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/packs/pack-js-ts
git commit -m "feat(pack-js-ts): implement JS/TS detection, rules and prompt templates"
```

---

### Task 5: Pack — Python

**Files:**
- Create: `packages/packs/pack-python/package.json`
- Create: `packages/packs/pack-python/tsconfig.json`
- Create: `packages/packs/pack-python/src/index.ts`
- Test: `packages/packs/pack-python/test/index.test.ts`

**Interfaces:**
- Consumes: `RepoSignals`, `Pack`, `DetectionResult`, `RuleSet`, `PromptTemplate` from Task 2.
- Produces: `pythonPack: Pack` with `id: "python"`, consumed by Task 12.

- [ ] **Step 1: Create `packages/packs/pack-python/package.json`** (same shape as Task 4 Step 1, `"name": "agent-rules-pack-python"`)

```json
{
  "name": "agent-rules-pack-python",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Create `packages/packs/pack-python/tsconfig.json`** (identical to Task 4 Step 2)

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `packages/packs/pack-python/test/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { pythonPack } from "../src/index.js";
import type { RepoSignals } from "../../../cli/src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("pythonPack", () => {
  it("returns null with no pyproject.toml or requirements.txt", () => {
    expect(pythonPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects FastAPI + pytest from pyproject.toml with high confidence", () => {
    const detection = pythonPack.detect(
      baseSignals({ pyprojectToml: 'dependencies = ["fastapi", "pytest"]' })
    );
    expect(detection?.framework).toEqual({ value: "fastapi", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "pytest", confidence: "high" });
  });

  it("detects from requirements.txt when pyproject.toml is absent", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "django==5.0\npytest==8.3.0" }));
    expect(detection?.framework?.value).toBe("django");
  });

  it("marks framework low confidence when nothing recognizable is found", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "some-random-lib==1.0" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "flask" }))!;
    const templates = pythonPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/packs/pack-python && npx vitest run`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 5: Implement `packages/packs/pack-python/src/index.ts`**

```typescript
import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../../../cli/src/core/types.js";

const FRAMEWORKS: [string, string][] = [
  ["fastapi", "fastapi"],
  ["django", "django"],
  ["flask", "flask"],
];

const TEST_RUNNERS: [string, string][] = [
  ["pytest", "pytest"],
  ["unittest", "unittest"],
];

function findIn(haystack: string, table: [string, string][]): DetectionField<string> | undefined {
  const lower = haystack.toLowerCase();
  for (const [needle, label] of table) {
    if (lower.includes(needle)) return { value: label, confidence: "high" };
  }
  return undefined;
}

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pyprojectToml ?? signals.requirementsTxt;
  if (!source) return null;

  const framework = findIn(source, FRAMEWORKS) ?? { value: "none", confidence: "low" as const };
  const testRunner = findIn(source, TEST_RUNNERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.hasFile("poetry.lock")
    ? { value: "poetry", confidence: "high" }
    : signals.pyprojectToml
    ? { value: "pip (pyproject.toml)", confidence: "low" }
    : { value: "pip", confidence: "low" };

  return { packId: "python", language: "Python", framework, testRunner, packageManager };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Python${framework !== "none" ? ` con ${framework}` : ""}.`,
    conventions: [
      "Sigue PEP 8; usa type hints en funciones públicas.",
      `Ejecuta los tests con ${detection.testRunner?.value ?? "el test runner del proyecto"} antes de terminar una tarea.`,
      "No introduzcas dependencias nuevas sin añadirlas al manifiesto de dependencias existente.",
    ],
    architectureNotes: [
      "Mantén la lógica de negocio separada de la capa de framework cuando el proyecto ya siga ese patrón.",
      "Usa entornos virtuales; no instales paquetes globalmente.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Python)",
      body: `Revisa el diff actual buscando bugs, manejo de excepciones incorrecto y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Python)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable. Respeta los type hints existentes.`,
    },
    {
      id: "testing",
      title: "Testing (Python)",
      body: `Escribe tests para el código señalado usando ${detection.testRunner?.value ?? "el test runner del proyecto"}. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const pythonPack: Pack = { id: "python", detect, rules, promptTemplates };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/packs/pack-python && npx vitest run`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/packs/pack-python
git commit -m "feat(pack-python): implement Python detection, rules and prompt templates"
```

---

### Task 6: Pack — Java

**Files:**
- Create: `packages/packs/pack-java/package.json`, `tsconfig.json`, `src/index.ts`
- Test: `packages/packs/pack-java/test/index.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `javaPack: Pack` with `id: "java"`, consumed by Task 12.

- [ ] **Step 1: Create `packages/packs/pack-java/package.json`**

```json
{
  "name": "agent-rules-pack-java",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Create `packages/packs/pack-java/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `packages/packs/pack-java/test/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { javaPack } from "../src/index.js";
import type { RepoSignals } from "../../../cli/src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("javaPack", () => {
  it("returns null with no pom.xml or build.gradle", () => {
    expect(javaPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Spring Boot + Maven from pom.xml with high confidence", () => {
    const detection = javaPack.detect(
      baseSignals({ pomXml: "<artifactId>spring-boot-starter-web</artifactId>" })
    );
    expect(detection?.framework).toEqual({ value: "spring", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "maven", confidence: "high" });
  });

  it("detects Gradle when build.gradle is present instead of pom.xml", () => {
    const detection = javaPack.detect(baseSignals({ buildGradle: "dependencies { }" }));
    expect(detection?.packageManager).toEqual({ value: "gradle", confidence: "high" });
  });

  it("marks framework low confidence when spring is not referenced", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }))!;
    const templates = javaPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/packs/pack-java && npx vitest run`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 5: Implement `packages/packs/pack-java/src/index.ts`**

```typescript
import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../../../cli/src/core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pomXml ?? signals.buildGradle;
  if (!source) return null;

  const framework: DetectionField<string> = /spring/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const packageManager: DetectionField<string> = signals.pomXml
    ? { value: "maven", confidence: "high" }
    : { value: "gradle", confidence: "high" };

  const testRunner: DetectionField<string> = /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "junit", confidence: "low" };

  return { packId: "java", language: "Java", framework, packageManager, testRunner };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Java${framework !== "none" ? ` con ${framework}` : ""} (${detection.packageManager?.value}).`,
    conventions: [
      "Sigue las convenciones de nombrado estándar de Java (PascalCase para clases, camelCase para métodos).",
      `Ejecuta los tests con ${detection.packageManager?.value === "maven" ? "mvn test" : "gradle test"} antes de terminar una tarea.`,
      "No añadas dependencias nuevas sin declararlas en el gestor de build existente.",
    ],
    architectureNotes: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Java)",
      body: `Revisa el diff actual buscando bugs, null-safety y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Java)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Java)",
      body: `Escribe tests con ${detection.testRunner?.value ?? "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const javaPack: Pack = { id: "java", detect, rules, promptTemplates };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/packs/pack-java && npx vitest run`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/packs/pack-java
git commit -m "feat(pack-java): implement Java detection, rules and prompt templates"
```

---

### Task 7: Pack — PHP

**Files:**
- Create: `packages/packs/pack-php/package.json`, `tsconfig.json`, `src/index.ts`
- Test: `packages/packs/pack-php/test/index.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `phpPack: Pack` with `id: "php"`, consumed by Task 12.

- [ ] **Step 1: Create `packages/packs/pack-php/package.json`**

```json
{
  "name": "agent-rules-pack-php",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Create `packages/packs/pack-php/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `packages/packs/pack-php/test/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { phpPack } from "../src/index.js";
import type { RepoSignals } from "../../../cli/src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("phpPack", () => {
  it("returns null with no composer.json", () => {
    expect(phpPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Laravel + PHPUnit with high confidence", () => {
    const detection = phpPack.detect(
      baseSignals({
        composerJson: {
          require: { "laravel/framework": "^11.0" },
          requireDev: { "phpunit/phpunit": "^11.0" },
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "laravel", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "phpunit", confidence: "high" });
  });

  it("marks framework low confidence when no known framework dependency is found", () => {
    const detection = phpPack.detect(
      baseSignals({ composerJson: { require: {}, requireDev: {} } })
    );
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("always reports composer as the package manager with high confidence", () => {
    const detection = phpPack.detect(baseSignals({ composerJson: { require: {}, requireDev: {} } }));
    expect(detection?.packageManager).toEqual({ value: "composer", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = phpPack.detect(
      baseSignals({ composerJson: { require: {}, requireDev: {} } })
    )!;
    const templates = phpPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/packs/pack-php && npx vitest run`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 5: Implement `packages/packs/pack-php/src/index.ts`**

```typescript
import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../../../cli/src/core/types.js";

const FRAMEWORKS: Record<string, string> = {
  "laravel/framework": "laravel",
  "symfony/symfony": "symfony",
  "codeigniter4/framework": "codeigniter",
};

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.composerJson) return null;
  const allDeps = { ...signals.composerJson.require, ...signals.composerJson.requireDev };

  let framework: DetectionField<string> = { value: "none", confidence: "low" };
  for (const [dep, label] of Object.entries(FRAMEWORKS)) {
    if (allDeps[dep]) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  const testRunner: DetectionField<string> = allDeps["phpunit/phpunit"]
    ? { value: "phpunit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "php",
    language: "PHP",
    framework,
    testRunner,
    packageManager: { value: "composer", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto PHP${framework !== "none" ? ` con ${framework}` : ""} (composer).`,
    conventions: [
      "Sigue PSR-12 para el estilo de código.",
      `Ejecuta los tests con ${detection.testRunner?.value === "phpunit" ? "vendor/bin/phpunit" : "el test runner del proyecto"} antes de terminar una tarea.`,
      "Declara toda dependencia nueva en composer.json, nunca la instales sin registrarla.",
    ],
    architectureNotes: [
      "Respeta la estructura MVC del framework si el proyecto ya la sigue.",
      "Evita lógica de negocio en los controladores cuando el proyecto ya use capas de servicio.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (PHP)",
      body: `Revisa el diff actual buscando bugs y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (PHP)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (PHP)",
      body: `Escribe tests con ${detection.testRunner?.value === "phpunit" ? "PHPUnit" : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const phpPack: Pack = { id: "php", detect, rules, promptTemplates };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/packs/pack-php && npx vitest run`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/packs/pack-php
git commit -m "feat(pack-php): implement PHP detection, rules and prompt templates"
```

---

### Task 8: Template renderer

**Files:**
- Create: `packages/cli/src/core/templates.ts`
- Test: `packages/cli/test/templates.test.ts`

**Interfaces:**
- Consumes: `RuleSet`, `PromptTemplate`, `DetectionResult` from Task 2.
- Produces: `renderClaudeMd(entries), renderAgentsMd(entries), renderCopilotInstructions(entries), renderPromptFile(template): { path: string; content: string }[]` — `entries: { detection: DetectionResult; ruleSet: RuleSet }[]` — consumed by Task 9 (writer) and Task 12 (CLI orchestration).

- [ ] **Step 1: Write the failing test `packages/cli/test/templates.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { renderClaudeMd, renderAgentsMd, renderCopilotInstructions, renderPromptFiles } from "../src/core/templates.js";
import type { DetectionResult, RuleSet, PromptTemplate } from "../src/core/types.js";

const detection: DetectionResult = {
  packId: "js-ts",
  language: "TypeScript/JavaScript",
  framework: { value: "react", confidence: "high" },
};
const ruleSet: RuleSet = {
  summary: "Proyecto JavaScript/TypeScript con react.",
  conventions: ["Usa TypeScript estricto."],
  architectureNotes: ["Mantén los componentes pequeños."],
};
const entries = [{ detection, ruleSet }];

describe("templates", () => {
  it("renders CLAUDE.md including each pack's summary and conventions", () => {
    const content = renderClaudeMd(entries);
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
    expect(content).toContain("Usa TypeScript estricto.");
  });

  it("renders AGENTS.md with the same rule content", () => {
    const content = renderAgentsMd(entries);
    expect(content).toContain("Mantén los componentes pequeños.");
  });

  it("renders copilot-instructions with the same rule content", () => {
    const content = renderCopilotInstructions(entries);
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
  });

  it("renders one file per prompt template with claude and vscode paths", () => {
    const templates: PromptTemplate[] = [{ id: "review", title: "Code Review (JS/TS)", body: "Revisa el diff." }];
    const files = renderPromptFiles(templates);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".claude/commands/review.generated.md",
      ".github/prompts/review.generated.prompt.md",
    ]);
    expect(files[0].content).toContain("Revisa el diff.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/templates.test.ts`
Expected: FAIL — `Cannot find module '../src/core/templates.js'`

- [ ] **Step 3: Implement `packages/cli/src/core/templates.ts`**

```typescript
import type { DetectionResult, PromptTemplate, RuleSet } from "./types.js";

export interface RenderEntry {
  detection: DetectionResult;
  ruleSet: RuleSet;
}

function renderSection(entries: RenderEntry[]): string {
  return entries
    .map(({ detection, ruleSet }) => {
      const conventions = ruleSet.conventions.map((c) => `- ${c}`).join("\n");
      const architecture = ruleSet.architectureNotes.map((a) => `- ${a}`).join("\n");
      return [
        `## ${detection.language} (${detection.packId})`,
        "",
        ruleSet.summary,
        "",
        "### Convenciones",
        conventions,
        "",
        "### Arquitectura",
        architecture,
      ].join("\n");
    })
    .join("\n\n");
}

export function renderClaudeMd(entries: RenderEntry[]): string {
  return [
    "# CLAUDE.md",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderAgentsMd(entries: RenderEntry[]): string {
  return [
    "# AGENTS.md",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderCopilotInstructions(entries: RenderEntry[]): string {
  return [
    "# Copilot Instructions",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderPromptFiles(templates: PromptTemplate[]): { path: string; content: string }[] {
  return templates.flatMap((template) => [
    {
      path: `.claude/commands/${template.id}.generated.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
    {
      path: `.github/prompts/${template.id}.generated.prompt.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/templates.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/templates.ts packages/cli/test/templates.test.ts
git commit -m "feat(cli): render CLAUDE.md, AGENTS.md, copilot-instructions and prompt files"
```

---

### Task 9: Writer

**Files:**
- Create: `packages/cli/src/core/writer.ts`
- Test: `packages/cli/test/writer.test.ts`

**Interfaces:**
- Consumes: nothing new (works on plain `{ path, content }[]`).
- Produces: `writeGeneratedFiles(rootPath: string, files: { path: string; content: string }[]): { path: string; status: "written" | "error"; error?: string }[]` — consumed by Task 12.

- [ ] **Step 1: Write the failing test `packages/cli/test/writer.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeGeneratedFiles } from "../src/core/writer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-writer-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeGeneratedFiles", () => {
  it("writes each file under the root path, creating nested directories", () => {
    const results = writeGeneratedFiles(tmpDir, [
      { path: "CLAUDE.generated.md", content: "hello" },
      { path: ".claude/commands/review.generated.md", content: "review body" },
    ]);
    expect(results.every((r) => r.status === "written")).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8")).toBe("hello");
    expect(fs.readFileSync(path.join(tmpDir, ".claude/commands/review.generated.md"), "utf-8")).toBe(
      "review body"
    );
  });

  it("never overwrites an existing file, reporting it as an error instead", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "already here");
    const results = writeGeneratedFiles(tmpDir, [{ path: "CLAUDE.generated.md", content: "new content" }]);
    expect(results[0].status).toBe("error");
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8")).toBe("already here");
  });

  it("continues writing remaining files after one fails", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "already here");
    const results = writeGeneratedFiles(tmpDir, [
      { path: "CLAUDE.generated.md", content: "new content" },
      { path: "AGENTS.generated.md", content: "agents content" },
    ]);
    expect(results[0].status).toBe("error");
    expect(results[1].status).toBe("written");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8")).toBe("agents content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/writer.test.ts`
Expected: FAIL — `Cannot find module '../src/core/writer.js'`

- [ ] **Step 3: Implement `packages/cli/src/core/writer.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface WriteResult {
  path: string;
  status: "written" | "error";
  error?: string;
}

export function writeGeneratedFiles(rootPath: string, files: GeneratedFile[]): WriteResult[] {
  return files.map(({ path: relativePath, content }) => {
    const absolutePath = path.join(rootPath, relativePath);
    try {
      if (fs.existsSync(absolutePath)) {
        return { path: relativePath, status: "error", error: "file already exists" };
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
      return { path: relativePath, status: "written" };
    } catch (err) {
      return { path: relativePath, status: "error", error: (err as Error).message };
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/writer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/writer.ts packages/cli/test/writer.test.ts
git commit -m "feat(cli): implement writer that never overwrites existing files"
```

---

### Task 10: LLM bridge

**Files:**
- Create: `packages/cli/src/core/llm-bridge.ts`
- Test: `packages/cli/test/llm-bridge.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `detectAvailableAssistants(execFn?: ExecFn): Promise<AssistantId[]>`, `polishWithAssistant(assistant: AssistantId, content: string, execFn?: ExecFn): Promise<string>` where `AssistantId = "claude" | "codex"` and `ExecFn = (command: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>` — consumed by Task 12.

- [ ] **Step 1: Write the failing test `packages/cli/test/llm-bridge.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { detectAvailableAssistants, polishWithAssistant } from "../src/core/llm-bridge.js";

describe("detectAvailableAssistants", () => {
  it("returns both assistants when both exec calls succeed", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "1.0.0", exitCode: 0 });
    const result = await detectAvailableAssistants(execFn);
    expect(result.sort()).toEqual(["claude", "codex"]);
  });

  it("returns only the assistant whose exec call succeeds", async () => {
    const execFn = vi.fn().mockImplementation(async (command: string) => {
      if (command === "claude") return { stdout: "1.0.0", exitCode: 0 };
      throw new Error("command not found");
    });
    const result = await detectAvailableAssistants(execFn);
    expect(result).toEqual(["claude"]);
  });

  it("returns an empty array when no assistant is available", async () => {
    const execFn = vi.fn().mockRejectedValue(new Error("command not found"));
    const result = await detectAvailableAssistants(execFn);
    expect(result).toEqual([]);
  });
});

describe("polishWithAssistant", () => {
  it("passes the content as a prompt and returns stdout", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "polished content", exitCode: 0 });
    const result = await polishWithAssistant("claude", "raw content", execFn);
    expect(result).toBe("polished content");
    expect(execFn).toHaveBeenCalledWith("claude", ["-p", expect.stringContaining("raw content")]);
  });

  it("falls back to the original content if the exec call fails", async () => {
    const execFn = vi.fn().mockRejectedValue(new Error("auth error"));
    const result = await polishWithAssistant("codex", "raw content", execFn);
    expect(result).toBe("raw content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/llm-bridge.test.ts`
Expected: FAIL — `Cannot find module '../src/core/llm-bridge.js'`

- [ ] **Step 3: Implement `packages/cli/src/core/llm-bridge.ts`**

```typescript
import { spawn } from "node:child_process";

export type AssistantId = "claude" | "codex";

export interface ExecResult {
  stdout: string;
  exitCode: number;
}

export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

const VERSION_ARGS: Record<AssistantId, string[]> = {
  claude: ["--version"],
  codex: ["--version"],
};

export const defaultExecFn: ExecFn = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: true });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve({ stdout, exitCode });
      else reject(new Error(`${command} exited with code ${exitCode}`));
    });
  });

export async function detectAvailableAssistants(execFn: ExecFn = defaultExecFn): Promise<AssistantId[]> {
  const candidates: AssistantId[] = ["claude", "codex"];
  const results = await Promise.all(
    candidates.map(async (id) => {
      try {
        await execFn(id, VERSION_ARGS[id]);
        return id;
      } catch {
        return null;
      }
    })
  );
  return results.filter((id): id is AssistantId => id !== null);
}

export async function polishWithAssistant(
  assistant: AssistantId,
  content: string,
  execFn: ExecFn = defaultExecFn
): Promise<string> {
  const prompt = `Pule la redacción del siguiente documento de instrucciones para un agente de IA, sin cambiar su significado ni estructura:\n\n${content}`;
  try {
    const result = await execFn(assistant, ["-p", prompt]);
    return result.stdout.trim() || content;
  } catch {
    return content;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/llm-bridge.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/llm-bridge.ts packages/cli/test/llm-bridge.test.ts
git commit -m "feat(cli): implement llm-bridge shelling out to claude/codex CLIs"
```

---

### Task 11: Prompt engine

**Files:**
- Create: `packages/cli/src/core/prompt-engine.ts`
- Test: `packages/cli/test/prompt-engine.test.ts`

**Interfaces:**
- Consumes: `DetectionResult` from Task 2.
- Produces: `collectLowConfidenceQuestions(detections: DetectionResult[]): Question[]` (pure, testable) where `Question = { packId: string; field: "framework" | "testRunner" | "linter" | "packageManager"; message: string }`, and `askQuestions(questions: Question[], promptFn?: PromptFn): Promise<Record<string, string>>` where `PromptFn = (message: string) => Promise<string>` — consumed by Task 12.

- [ ] **Step 1: Write the failing test `packages/cli/test/prompt-engine.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { collectLowConfidenceQuestions, askQuestions } from "../src/core/prompt-engine.js";
import type { DetectionResult } from "../src/core/types.js";

describe("collectLowConfidenceQuestions", () => {
  it("returns no questions when all fields are high confidence", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "react", confidence: "high" },
        testRunner: { value: "vitest", confidence: "high" },
      },
    ];
    expect(collectLowConfidenceQuestions(detections)).toEqual([]);
  });

  it("returns one question per low-confidence field", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "none", confidence: "low" },
        testRunner: { value: "vitest", confidence: "high" },
      },
    ];
    const questions = collectLowConfidenceQuestions(detections);
    expect(questions).toEqual([
      {
        packId: "js-ts",
        field: "framework",
        message: "No se pudo determinar el framework para TypeScript/JavaScript. ¿Cuál usáis?",
      },
    ]);
  });
});

describe("askQuestions", () => {
  it("calls promptFn once per question and maps answers by 'packId:field'", async () => {
    const promptFn = vi.fn().mockResolvedValue("express");
    const answers = await askQuestions(
      [{ packId: "js-ts", field: "framework", message: "¿Cuál framework?" }],
      promptFn
    );
    expect(promptFn).toHaveBeenCalledWith("¿Cuál framework?");
    expect(answers).toEqual({ "js-ts:framework": "express" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/prompt-engine.test.ts`
Expected: FAIL — `Cannot find module '../src/core/prompt-engine.js'`

- [ ] **Step 3: Implement `packages/cli/src/core/prompt-engine.ts`**

```typescript
import * as clack from "@clack/prompts";
import type { DetectionResult } from "./types.js";

export type QuestionField = "framework" | "testRunner" | "linter" | "packageManager";

export interface Question {
  packId: string;
  field: QuestionField;
  message: string;
}

const FIELDS: QuestionField[] = ["framework", "testRunner", "linter", "packageManager"];

export function collectLowConfidenceQuestions(detections: DetectionResult[]): Question[] {
  const questions: Question[] = [];
  for (const detection of detections) {
    for (const field of FIELDS) {
      const detectionField = detection[field];
      if (detectionField && detectionField.confidence === "low") {
        questions.push({
          packId: detection.packId,
          field,
          message: `No se pudo determinar el ${field} para ${detection.language}. ¿Cuál usáis?`,
        });
      }
    }
  }
  return questions;
}

export type PromptFn = (message: string) => Promise<string>;

export const defaultPromptFn: PromptFn = async (message) => {
  const answer = await clack.text({ message });
  return typeof answer === "string" ? answer : "";
};

export async function askQuestions(
  questions: Question[],
  promptFn: PromptFn = defaultPromptFn
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    answers[`${question.packId}:${question.field}`] = await promptFn(question.message);
  }
  return answers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/prompt-engine.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Install `@clack/prompts` and commit**

```bash
cd packages/cli && npm install @clack/prompts@^0.9.1
cd ../..
git add packages/cli/src/core/prompt-engine.ts packages/cli/test/prompt-engine.test.ts packages/cli/package.json package-lock.json
git commit -m "feat(cli): implement prompt engine for low-confidence fields"
```

---

### Task 12: CLI orchestration

**Files:**
- Create: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `scanRepo` (Task 3), `jsTsPack`/`pythonPack`/`javaPack`/`phpPack` (Tasks 4-7), `renderClaudeMd`/`renderAgentsMd`/`renderCopilotInstructions`/`renderPromptFiles` (Task 8), `writeGeneratedFiles` (Task 9), `detectAvailableAssistants`/`polishWithAssistant` (Task 10), `collectLowConfidenceQuestions`/`askQuestions` (Task 11).
- Produces: `runCli(rootPath: string, options: { promptFn?: PromptFn; execFn?: ExecFn; skipLlm?: boolean }): Promise<WriteResult[]>` — the function invoked by the `bin` entry point.

- [ ] **Step 1: Write the failing test `packages/cli/test/cli.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCli } from "../src/cli.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-cli-"));
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      dependencies: { react: "^18.3.0" },
      devDependencies: { vitest: "^2.1.0" },
    })
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runCli", () => {
  it("generates CLAUDE.md, AGENTS.md, copilot-instructions and prompt files for a JS/TS repo", async () => {
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });

    expect(results.find((r) => r.path === "CLAUDE.generated.md")?.status).toBe("written");
    expect(results.find((r) => r.path === "AGENTS.generated.md")?.status).toBe("written");
    expect(
      results.find((r) => r.path === ".github/copilot-instructions.generated.md")?.status
    ).toBe("written");
    expect(
      results.find((r) => r.path === ".claude/commands/review.generated.md")?.status
    ).toBe("written");

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("react");
  });

  it("asks a question when a pack detects with low confidence", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    const promptFn = vi.fn().mockResolvedValue("custom-framework");
    await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(promptFn).toHaveBeenCalled();
  });

  it("falls back to the plain questionnaire when no pack detects anything", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/cli.test.ts`
Expected: FAIL — `Cannot find module '../src/cli.js'`

- [ ] **Step 3: Implement `packages/cli/src/cli.ts`**

```typescript
#!/usr/bin/env node
import * as clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { writeGeneratedFiles, type WriteResult } from "./core/writer.js";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderPromptFiles,
  type RenderEntry,
} from "./core/templates.js";
import { collectLowConfidenceQuestions, askQuestions, defaultPromptFn, type PromptFn } from "./core/prompt-engine.js";
import { detectAvailableAssistants, polishWithAssistant, defaultExecFn, type ExecFn } from "./core/llm-bridge.js";
import type { Pack } from "./core/types.js";
import { jsTsPack } from "agent-rules-pack-js-ts";
import { pythonPack } from "agent-rules-pack-python";
import { javaPack } from "agent-rules-pack-java";
import { phpPack } from "agent-rules-pack-php";

const ALL_PACKS: Pack[] = [jsTsPack, pythonPack, javaPack, phpPack];

export interface RunCliOptions {
  promptFn?: PromptFn;
  execFn?: ExecFn;
  skipLlm?: boolean;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const promptFn = options.promptFn ?? defaultPromptFn;
  const execFn = options.execFn ?? defaultExecFn;

  const signals = scanRepo(rootPath);
  const detections = ALL_PACKS.map((pack) => pack.detect(signals)).filter((d): d is NonNullable<typeof d> => d !== null);

  const questions = collectLowConfidenceQuestions(detections);
  await askQuestions(questions, promptFn);

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection) };
  });

  const files: { path: string; content: string }[] = [];

  if (entries.length > 0) {
    files.push({ path: "CLAUDE.generated.md", content: renderClaudeMd(entries) });
    files.push({ path: "AGENTS.generated.md", content: renderAgentsMd(entries) });
    files.push({
      path: ".github/copilot-instructions.generated.md",
      content: renderCopilotInstructions(entries),
    });
    for (const detection of detections) {
      const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
      for (const file of renderPromptFiles(pack.promptTemplates(detection))) {
        files.push(file);
      }
    }
  } else {
    files.push({
      path: "CLAUDE.generated.md",
      content: "# CLAUDE.md\n\nNo se detectó ningún stack conocido. Completa este archivo manualmente.\n",
    });
  }

  if (!options.skipLlm) {
    const assistants = await detectAvailableAssistants(execFn);
    if (assistants.length > 0) {
      const usePolish = await clack.confirm({
        message: `Se detectó ${assistants.join(" y ")}. ¿Quieres que pula la redacción final?`,
      });
      if (usePolish === true) {
        for (const file of files) {
          file.content = await polishWithAssistant(assistants[0], file.content, execFn);
        }
      }
    }
  }

  return writeGeneratedFiles(rootPath, files);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/cli.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Build all workspaces to verify cross-package imports resolve**

Run: `npm run build --workspaces --if-present`
Expected: exits 0, `dist/` created in `packages/cli` and each `packages/packs/*`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): wire scanner, packs, templates, writer and llm-bridge into runCli"
```

---

### Task 13: Docs, license and CI

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/writing-a-pack.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing (documentation/CI only).
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Create `LICENSE`** (MIT, current year 2026, holder placeholder using repo owner's GitHub handle if known, otherwise generic)

```
MIT License

Copyright (c) 2026 agent-rules-init contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `README.md`**

```markdown
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

## Contribuir

Añadir soporte a un stack nuevo es implementar la interfaz `Pack` en `packages/packs/`. Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) y [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia

MIT — ver [`LICENSE`](LICENSE).
```

- [ ] **Step 3: Create `CONTRIBUTING.md`**

```markdown
# Contribuir a agent-rules-init

## Desarrollo local

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Añadir un stack nuevo

Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) — un pack nuevo es una carpeta en `packages/packs/` que implementa la interfaz `Pack`, sin tocar `packages/cli/src/core/`.

## Pull requests

- Un PR por cambio lógico.
- Cada pack nuevo o modificado debe incluir tests unitarios (`detect`, `rules`, `promptTemplates`) con al menos un caso de confianza alta y uno de confianza baja.
- `npm run test --workspaces --if-present` debe pasar antes de abrir el PR.
```

- [ ] **Step 4: Create `docs/writing-a-pack.md`**

```markdown
# Cómo escribir un pack

Un pack implementa la interfaz `Pack` definida en `packages/cli/src/core/types.ts`:

```typescript
interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;
  promptTemplates(detection: DetectionResult): PromptTemplate[];
}
```

## Pasos

1. Crea `packages/packs/pack-<stack>/` con `package.json`, `tsconfig.json` y `src/index.ts` — usa `packages/packs/pack-python` como referencia de estructura.
2. `detect()` debe devolver `null` si no encuentra ninguna señal de que el stack aplica (ej. ningún manifiesto reconocible). Si aplica, marca cada campo (`framework`, `testRunner`, `linter`, `packageManager`) con `confidence: "high"` solo cuando la señal sea inequívoca (ej. una dependencia conocida presente); si no, usa `confidence: "low"` — esos campos se preguntarán al usuario.
3. `rules()` traduce la detección en un `RuleSet` (resumen + convenciones + notas de arquitectura), en español, orientado a un agente de IA que va a trabajar en ese repo.
4. `promptTemplates()` debe devolver exactamente tres plantillas con `id: "review" | "refactor" | "testing"`.
5. Añade tests en `test/index.test.ts` cubriendo: sin señales (`null`), detección de alta confianza, detección de baja confianza, y que las tres plantillas de prompt se generan.
6. Registra el pack en `ALL_PACKS` dentro de `packages/cli/src/cli.ts` y añádelo como dependencia en `packages/cli/package.json`.
```

- [ ] **Step 5: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npm run build --workspaces --if-present
      - run: npm run test --workspaces --if-present
```

- [ ] **Step 6: Commit**

```bash
git add LICENSE README.md CONTRIBUTING.md docs/writing-a-pack.md .github/workflows/ci.yml
git commit -m "docs: add README, LICENSE, CONTRIBUTING, pack authoring guide and CI"
```

---

### Task 14: Full workspace verification

**Files:** none created — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite across all workspaces**

Run: `npm run test --workspaces --if-present`
Expected: all suites pass (scanner, templates, writer, llm-bridge, prompt-engine, cli, and each of the 4 packs).

- [ ] **Step 2: Run the full build across all workspaces**

Run: `npm run build --workspaces --if-present`
Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Smoke-test the CLI end-to-end against a scratch fixture copy**

Run (bash):
```bash
cp -r fixtures/node-react-vitest /tmp/agent-rules-init-smoke
node packages/cli/dist/cli.js # if cli.ts exports runCli, invoke via a tiny script instead:
node -e "require('./packages/cli/dist/cli.js').runCli('/tmp/agent-rules-init-smoke', { skipLlm: true, promptFn: async () => '' }).then(r => console.log(r))"
ls /tmp/agent-rules-init-smoke
rm -rf /tmp/agent-rules-init-smoke
```
Expected: `CLAUDE.generated.md`, `AGENTS.generated.md`, `.github/copilot-instructions.generated.md` and prompt files listed; process exits without throwing.

- [ ] **Step 4: Final commit if verification produced any fixups**

```bash
git status
```
If clean, no commit needed — this task is verification-only.
