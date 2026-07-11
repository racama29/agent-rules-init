# Calidad de contenido (Fases 1–3 del roadmap) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar los datos ya detectados en instrucciones específicas del repositorio: eliminar consejos incompatibles con las señales, introducir comandos canónicos con procedencia y enriquecer los prompts de JS/TS, Python y Java con comandos y rutas reales.

**Architecture:** Se añade un módulo `canonical-commands.ts` que selecciona un comando principal por tipo (test/lint/build/format/typecheck) desde scripts de manifiesto → CI → wrappers/fallbacks, con procedencia y confianza. `RepoFacts` se amplía con `canonical`, `testDirs` y `entrypoints`. El contrato de `Pack.rules`/`Pack.promptTemplates` gana un tercer parámetro opcional `ctx: PackContext` con esos hechos, y los packs js-ts, python y java lo usan para generar prompts con comandos y rutas reales. Un corpus de fixtures con snapshots protege cada cambio.

**Tech Stack:** TypeScript (ESM, imports con sufijo `.js`), Node >= 18, vitest, monorepo npm workspaces (`packages/cli`).

**Alcance:** Este plan cubre las prioridades 1–3 del roadmap (`docs/content-quality-roadmap.md`): Fase 1 (incoherencias), Fase 2 (modelo de hechos), Fase 3 (prompts enriquecidos) más la parte del corpus (Línea 7) necesaria para auditar. Las Fases 4–5 (documentos por consumidor, QA en CI) quedan para un plan posterior.

## Global Constraints

- **No inventar:** toda afirmación específica del output generado necesita una señal local (archivo del repo analizado); ante la duda, omitir la regla.
- **Bilingüe:** todo texto visible para el usuario final debe existir en `es` y `en`; los tests de packs cubren ambos idiomas.
- **Nada de sentinelas:** los prompts generados no pueden contener "the project's framework", "el framework del proyecto", "the project's test runner" ni "el test runner del proyecto".
- **Comandos ejecutables:** preferir `npm test`, `uv run pytest`, `./mvnw verify` frente al nombre abstracto de la herramienta; nunca exigir instalación global si existe wrapper o gestor local.
- **Compatibilidad:** `Pack.rules`/`Pack.promptTemplates` ganan un parámetro **opcional**; los 12 packs no enriquecidos deben seguir compilando y pasando tests sin cambios de comportamiento.
- **Idempotencia:** dos ejecuciones seguidas sobre el mismo repo producen bytes idénticos (`--check` estable).
- Working dir para comandos de test: `packages/cli` (`npx vitest run <archivo>`); suite completa/build/lint desde la raíz: `npm test`, `npm run build`, `npm run lint`.
- Mensajes de commit en inglés, estilo convencional (`feat:`, `fix:`, `test:`), terminados en `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Corpus de fixtures + snapshots baseline

Crea tres fixtures que imitan el corpus del roadmap (Express, Flask, Petclinic) y un test de snapshots que fija el output actual ANTES de tocar nada. Las tareas siguientes actualizarán los snapshots de forma consciente con `-u`.

**Files:**
- Create: `fixtures/node-express-mocha/package.json`
- Create: `fixtures/node-express-mocha/package-lock.json`
- Create: `fixtures/node-express-mocha/lib/app.js`
- Create: `fixtures/node-express-mocha/test/app.test.js`
- Create: `fixtures/node-express-mocha/test/acceptance/routes.test.js`
- Create: `fixtures/node-express-mocha/.github/workflows/ci.yml`
- Create: `fixtures/python-uv-tox/pyproject.toml`
- Create: `fixtures/python-uv-tox/uv.lock`
- Create: `fixtures/python-uv-tox/tox.ini`
- Create: `fixtures/python-uv-tox/src/fixture_app/__init__.py`
- Create: `fixtures/python-uv-tox/src/fixture_app/cli.py`
- Create: `fixtures/python-uv-tox/tests/test_cli.py`
- Create: `fixtures/python-uv-tox/.github/workflows/tests.yml`
- Create: `fixtures/java-spring-maven/pom.xml`
- Create: `fixtures/java-spring-maven/mvnw`
- Create: `fixtures/java-spring-maven/mvnw.cmd`
- Create: `fixtures/java-spring-maven/build.gradle`
- Create: `fixtures/java-spring-maven/gradlew`
- Create: `fixtures/java-spring-maven/src/main/java/demo/App.java`
- Create: `fixtures/java-spring-maven/src/test/java/demo/AppTest.java`
- Create: `fixtures/java-spring-maven/.github/workflows/build.yml`
- Test: `packages/cli/test/corpus.test.ts`

**Interfaces:**
- Consumes: `runCli(rootPath, options)` de `packages/cli/src/cli.ts` (ya existe).
- Produces: fixtures reutilizados por las Tasks 8–11; helper `renderCorpus(fixtureName, lang)` exportado solo dentro del test.

- [ ] **Step 1: Crear los archivos del fixture Express-like**

`fixtures/node-express-mocha/package.json`:

```json
{
  "name": "fixture-node-express-mocha",
  "main": "lib/app.js",
  "dependencies": { "express": "^4.19.0" },
  "devDependencies": { "mocha": "^10.4.0", "eslint": "^9.0.0" },
  "scripts": {
    "test": "mocha --recursive test/",
    "lint": "eslint lib/ test/"
  }
}
```

`fixtures/node-express-mocha/package-lock.json`:

```json
{ "name": "fixture-node-express-mocha", "lockfileVersion": 3 }
```

`fixtures/node-express-mocha/lib/app.js`:

```js
const express = require("express");
module.exports = express();
```

`fixtures/node-express-mocha/test/app.test.js`:

```js
require("../lib/app");
```

`fixtures/node-express-mocha/test/acceptance/routes.test.js`:

```js
require("../../lib/app");
```

`fixtures/node-express-mocha/.github/workflows/ci.yml`:

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
      - run: npm run lint
```

- [ ] **Step 2: Crear los archivos del fixture Flask-like**

`fixtures/python-uv-tox/pyproject.toml`:

```toml
[project]
name = "fixture-python-uv-tox"
dependencies = ["flask"]

[project.optional-dependencies]
dev = ["pytest"]

[project.scripts]
fixture-app = "fixture_app.cli:main"
```

`fixtures/python-uv-tox/uv.lock`:

```toml
version = 1
```

`fixtures/python-uv-tox/tox.ini`:

```ini
[tox]
env_list = py311, style
```

`fixtures/python-uv-tox/src/fixture_app/__init__.py`: archivo vacío.

`fixtures/python-uv-tox/src/fixture_app/cli.py`:

```python
def main() -> None:
    print("fixture")
```

`fixtures/python-uv-tox/tests/test_cli.py`:

```python
from fixture_app.cli import main


def test_main() -> None:
    main()
```

`fixtures/python-uv-tox/.github/workflows/tests.yml`:

```yaml
name: tests
on: push
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: uv run pytest
```

- [ ] **Step 3: Crear los archivos del fixture Petclinic-like**

`fixtures/java-spring-maven/pom.xml`:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo</groupId>
  <artifactId>fixture-java-spring-maven</artifactId>
  <version>0.1.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.3.0</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
```

`fixtures/java-spring-maven/mvnw` (stub, basta con que exista):

```sh
#!/bin/sh
exec mvn "$@"
```

`fixtures/java-spring-maven/mvnw.cmd`:

```bat
mvn %*
```

`fixtures/java-spring-maven/build.gradle`:

```groovy
plugins { id 'java' }
```

`fixtures/java-spring-maven/gradlew`:

```sh
#!/bin/sh
exec gradle "$@"
```

`fixtures/java-spring-maven/src/main/java/demo/App.java`:

```java
package demo;
public class App {}
```

`fixtures/java-spring-maven/src/test/java/demo/AppTest.java`:

```java
package demo;
public class AppTest {}
```

`fixtures/java-spring-maven/.github/workflows/build.yml`:

```yaml
name: build
on: push
jobs:
  maven:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./mvnw -B verify
  gradle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./gradlew build
```

- [ ] **Step 4: Escribir el test de snapshots del corpus**

`packages/cli/test/corpus.test.ts`:

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";
import type { Lang } from "../src/core/i18n.js";

const FIXTURES_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");

const CORPUS = [
  "node-express-mocha",
  "python-uv-tox",
  "java-spring-maven",
  "node-react-vitest",
  "python-fastapi",
  "monorepo-js-python",
] as const;

async function renderCorpus(fixture: string, lang: Lang): Promise<Map<string, string>> {
  let generated: readonly GeneratedFile[] = [];
  await runCli(path.join(FIXTURES_ROOT, fixture), {
    lang,
    dryRun: true,
    nonInteractive: true,
    skipLlm: true,
    onGeneratedFiles: (files) => {
      generated = files;
    },
  });
  return new Map(generated.map((f) => [f.path, f.content]));
}

describe("corpus snapshots", () => {
  for (const fixture of CORPUS) {
    for (const lang of ["es", "en"] as const) {
      it(`${fixture} (${lang})`, async () => {
        const files = await renderCorpus(fixture, lang);
        expect(Object.fromEntries(files)).toMatchSnapshot();
      });
    }
  }

  it("produces identical output across two runs", async () => {
    const first = await renderCorpus("node-express-mocha", "en");
    const second = await renderCorpus("node-express-mocha", "en");
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  });
});
```

- [ ] **Step 5: Ejecutar el test para generar los snapshots baseline**

Run (desde `packages/cli`): `npx vitest run test/corpus.test.ts`
Expected: PASS, con "snapshots written" (13 tests: 12 snapshots + estabilidad).

- [ ] **Step 6: Ejecutar la suite completa para confirmar que nada se rompe**

Run (desde la raíz): `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add fixtures/ packages/cli/test/corpus.test.ts packages/cli/test/__snapshots__/
git commit -m "test: add corpus fixtures and baseline snapshots for content quality work"
```

---

### Task 2: (Fase 1) Foco de review condicional en js-ts

Un proyecto JavaScript sin TypeScript no debe recibir "errores de tipado" en su prompt de review.

**Files:**
- Modify: `packages/cli/src/packs/js-ts.ts` (TEXTS y `promptTemplates`, líneas ~124–178)
- Test: `packages/cli/test/packs/js-ts.test.ts`

**Interfaces:**
- Consumes: `jsTsPack.promptTemplates(detection, lang)` actual.
- Produces: mismo contrato; solo cambia el texto según `detection.usesTypeScript`.

- [ ] **Step 1: Escribir los tests negativos que fallan**

Añadir a `packages/cli/test/packs/js-ts.test.ts`:

```typescript
it("does not mention typing errors in the review prompt for plain JavaScript", () => {
  const detection = jsTsPack.detect(
    baseSignals({
      packageJson: { dependencies: {}, devDependencies: { mocha: "^10" }, scripts: {}, moduleType: "commonjs" },
    })
  )!;
  expect(detection.usesTypeScript).toBe(false);
  for (const lang of ["es", "en"] as const) {
    const review = jsTsPack.promptTemplates(detection, lang).find((t) => t.id === "review")!;
    expect(review.body).not.toMatch(/tipado|typing/i);
  }
});

it("keeps typing errors in the review prompt for TypeScript projects", () => {
  const detection = jsTsPack.detect(
    baseSignals({
      packageJson: { dependencies: {}, devDependencies: { typescript: "^5" }, scripts: {}, moduleType: "module" },
    })
  )!;
  expect(detection.usesTypeScript).toBe(true);
  const review = jsTsPack.promptTemplates(detection, "en").find((t) => t.id === "review")!;
  expect(review.body).toMatch(/typing/i);
});
```

- [ ] **Step 2: Verificar que el primer test falla**

Run: `npx vitest run test/packs/js-ts.test.ts`
Expected: FAIL — el body contiene "tipado"/"typing" para JS plano.

- [ ] **Step 3: Implementar el foco condicional**

En `packages/cli/src/packs/js-ts.ts`, en `TEXTS`, sustituir la clave `reviewFocus` por dos:

```typescript
    reviewFocusTs: "errores de tipado, condiciones de carrera en async/await",
    reviewFocusJs: "condiciones de carrera en async/await",
```

(y en `en`):

```typescript
    reviewFocusTs: "typing errors, async/await race conditions",
    reviewFocusJs: "async/await race conditions",
```

Actualizar el tipo del Record de `TEXTS` (`reviewFocus: string` → `reviewFocusTs: string; reviewFocusJs: string`). En `promptTemplates`, sustituir la línea del review por:

```typescript
    { id: "review", title: "Code Review (JS/TS)", body: reviewBody(lang, detection.usesTypeScript ? t.reviewFocusTs : t.reviewFocusJs, framework) },
```

- [ ] **Step 4: Verificar que los tests pasan**

Run: `npx vitest run test/packs/js-ts.test.ts`
Expected: PASS.

- [ ] **Step 5: Actualizar snapshots del corpus de forma consciente**

Run: `npx vitest run test/corpus.test.ts -u` y después `npx vitest run`
Expected: solo cambian los snapshots de fixtures JS sin TypeScript (desaparece "tipado"/"typing" del prompt de review). Suite completa PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/packs/js-ts.ts packages/cli/test/packs/js-ts.test.ts packages/cli/test/__snapshots__/
git commit -m "fix(js-ts): only mention typing errors in review prompts for TypeScript projects"
```

---

### Task 3: (Fase 1) Eliminar los sentinelas de framework y test runner desconocidos

Cuando no hay framework o runner detectado, la frase debe omitir esa parte, no rellenarla con "el framework del proyecto".

**Files:**
- Modify: `packages/cli/src/core/i18n.ts` (`reviewBody`, `testingBody`, `runTestsConvention`; eliminar `unknownFrameworkLabel` y `unknownRunnerLabel`)
- Modify: los 15 packs en `packages/cli/src/packs/*.ts` (mismo patrón de 2 líneas en cada uno)
- Modify: `packages/cli/test/i18n.test.ts` (tests de las funciones cambiadas)
- Test: `packages/cli/test/no-sentinels.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `reviewBody(lang: Lang, focus: string, framework?: string): string`, `testingBody(lang: Lang, runner?: string): string`, `runTestsConvention(lang: Lang, cmd?: string): string`. `unknownFrameworkLabel`/`unknownRunnerLabel` dejan de existir; ningún pack debe importarlas.

- [ ] **Step 1: Escribir el test negativo global que falla**

`packages/cli/test/no-sentinels.test.ts`:

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";

const FIXTURES_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");
const SENTINELS = [
  "the project's framework",
  "el framework del proyecto",
  "the project's test runner",
  "el test runner del proyecto",
];
const CORPUS = [
  "node-express-mocha",
  "python-uv-tox",
  "java-spring-maven",
  "node-react-vitest",
  "python-fastapi",
  "monorepo-js-python",
] as const;

describe("generated content contains no vague sentinels", () => {
  for (const fixture of CORPUS) {
    for (const lang of ["es", "en"] as const) {
      it(`${fixture} (${lang})`, async () => {
        let generated: readonly GeneratedFile[] = [];
        await runCli(path.join(FIXTURES_ROOT, fixture), {
          lang, dryRun: true, nonInteractive: true, skipLlm: true,
          onGeneratedFiles: (files) => { generated = files; },
        });
        for (const file of generated) {
          for (const sentinel of SENTINELS) {
            expect(file.content, `${file.path} contiene "${sentinel}"`).not.toContain(sentinel);
          }
        }
      });
    }
  }
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run test/no-sentinels.test.ts`
Expected: FAIL en fixtures sin framework/runner detectado (p. ej. `java-spring-maven` usa runner junit pero `monorepo-js-python` y `python-fastapi` producen sentinelas).

- [ ] **Step 3: Cambiar las funciones de i18n**

En `packages/cli/src/core/i18n.ts` sustituir `reviewBody`, `testingBody` y `runTestsConvention` por:

```typescript
export function runTestsConvention(lang: Lang, cmd?: string): string {
  if (cmd) {
    return lang === "es"
      ? `Ejecuta los tests con ${cmd} antes de terminar una tarea.`
      : `Run the tests with ${cmd} before finishing a task.`;
  }
  return lang === "es"
    ? "Ejecuta la suite de tests del repositorio antes de terminar una tarea."
    : "Run the repository's test suite before finishing a task.";
}

export function reviewBody(lang: Lang, focus: string, framework?: string): string {
  // Con focus vacío la frase colapsa a "bugs y desviaciones" sin coma colgante.
  const focusPart = focus ? `, ${focus}` : "";
  if (framework) {
    return lang === "es"
      ? `Revisa el diff actual buscando bugs${focusPart} y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`
      : `Review the current diff looking for bugs${focusPart} and deviations from ${framework} conventions. Point out only concrete issues with file and line.`;
  }
  return lang === "es"
    ? `Revisa el diff actual buscando bugs${focusPart}. Señala solo problemas concretos con línea de archivo.`
    : `Review the current diff looking for bugs${focusPart}. Point out only concrete issues with file and line.`;
}

export function testingBody(lang: Lang, runner?: string): string {
  if (runner) {
    return lang === "es"
      ? `Escribe tests con ${runner} para el código señalado. Cubre el camino feliz y al menos un caso límite.`
      : `Write tests with ${runner} for the highlighted code. Cover the happy path and at least one edge case.`;
  }
  return lang === "es"
    ? "Escribe tests para el código señalado. Cubre el camino feliz y al menos un caso límite."
    : "Write tests for the highlighted code. Cover the happy path and at least one edge case.";
}
```

Eliminar por completo `unknownRunnerLabel` y `unknownFrameworkLabel`.

- [ ] **Step 4: Actualizar los 15 packs**

En cada pack, el patrón actual es (con variaciones menores de nombre):

```typescript
const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
```

Sustituirlo en **todos** por:

```typescript
const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
```

y quitar `unknownFrameworkLabel`/`unknownRunnerLabel` de los imports. Archivos afectados (aplicar el mismo cambio en cada uno, tanto en `rules` como en `promptTemplates` si aparece en ambos): `js-ts.ts`, `python.ts`, `java.ts`, `php.ts`, `ruby.ts`, `go.ts`, `rust.ts`, `csharp.ts`, `kotlin.ts`, `swift.ts`, `dart.ts`, `cpp.ts`, `elixir.ts`, `scala.ts`, `r.ts`. En los `rules` que hacían `runTestsConvention(lang, runner ?? unknownRunnerLabel(lang))`, pasar simplemente `runner` (puede ser `undefined`; la función ya lo maneja). Nota: `java.ts` calcula `testCmd` propio y no necesita cambio en `rules`, solo en `promptTemplates`.

- [ ] **Step 5: Actualizar tests de i18n existentes**

En `packages/cli/test/i18n.test.ts`, eliminar/ajustar los tests que referencien `unknownFrameworkLabel`/`unknownRunnerLabel` y añadir:

```typescript
it("omits the framework clause when no framework is known", () => {
  expect(reviewBody("en", "focus")).toBe(
    "Review the current diff looking for bugs, focus. Point out only concrete issues with file and line."
  );
  expect(reviewBody("es", "")).toBe(
    "Revisa el diff actual buscando bugs. Señala solo problemas concretos con línea de archivo."
  );
});

it("falls back to a generic testing prompt without naming a runner", () => {
  expect(testingBody("en")).toBe(
    "Write tests for the highlighted code. Cover the happy path and at least one edge case."
  );
});
```

- [ ] **Step 6: Verificar typecheck y tests**

Run (raíz): `npm run lint` — Expected: sin errores (ningún import huérfano).
Run (packages/cli): `npx vitest run test/no-sentinels.test.ts test/i18n.test.ts` — Expected: PASS.

- [ ] **Step 7: Actualizar snapshots del corpus y pasar la suite**

Run: `npx vitest run test/corpus.test.ts -u` y después `npm test` (raíz)
Expected: los snapshots pierden las frases sentinela; suite completa PASS (incluidos `test/packs/i18n-en.test.ts` y demás — si alguno asertaba el sentinela, actualizar su aserción al nuevo texto sin framework/runner).

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "fix(packs): drop vague framework/runner sentinels from generated rules and prompts"
```

---

### Task 4: (Fase 2) Módulo de comandos canónicos — scripts y CI

**Files:**
- Modify: `packages/cli/src/core/types.ts` (añadir `CanonicalCommand`, ampliar `RepoFacts`)
- Create: `packages/cli/src/core/canonical-commands.ts`
- Test: `packages/cli/test/canonical-commands.test.ts`

**Interfaces:**
- Consumes: `CommandEntry`, `CiCommand`, `RepoSignals` de `types.ts`.
- Produces:
  - Tipo `CanonicalCommand { kind: "test"|"lint"|"build"|"format"|"typecheck"; command: string; source: string; confidence: Confidence; scope: string }` en `types.ts`.
  - `RepoFacts.canonical: CanonicalCommand[]` (se rellena en Task 6; en esta task solo se añade al tipo con las actualizaciones mínimas para compilar).
  - `selectCanonicalCommands(signals: RepoSignals, commands: CommandEntry[], ciCommands: CiCommand[]): CanonicalCommand[]` — máximo un comando por kind, prioridad scripts > CI (> fallbacks en Task 5).
  - `export const SOURCE_FILES: Record<CommandSource, string>` se muda de `templates.ts` a `canonical-commands.ts` (templates lo importa desde ahí).

- [ ] **Step 1: Añadir los tipos**

En `packages/cli/src/core/types.ts`, después de `CiCommand`:

```typescript
export interface CanonicalCommand {
  kind: "test" | "lint" | "build" | "format" | "typecheck";
  command: string;
  /** Archivo o señal del que procede el comando, p. ej. `package.json`, `ci: ci.yml`, `mvnw`. */
  source: string;
  confidence: Confidence;
  /** "." para la raíz del repo; ruta del workspace para unidades anidadas. */
  scope: string;
}
```

y en `RepoFacts` añadir el campo `canonical: CanonicalCommand[];`. Para que compile ya: en `buildRepoFacts` (`repo-facts.ts`) añadir provisionalmente `canonical: []` al objeto devuelto (Task 6 lo rellena de verdad).

- [ ] **Step 2: Escribir los tests que fallan**

`packages/cli/test/canonical-commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectCanonicalCommands } from "../src/core/canonical-commands.js";
import type { CiCommand, CommandEntry, RepoSignals } from "../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals> = {}): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const none: CiCommand[] = [];

describe("selectCanonicalCommands", () => {
  it("picks test and lint from root manifest scripts", () => {
    const commands: CommandEntry[] = [
      { source: "npm", invocation: "npm test", detail: "mocha --recursive test/" },
      { source: "npm", invocation: "npm run lint", detail: "eslint lib/ test/" },
      { source: "npm", invocation: "npm run docs", detail: "jsdoc" },
    ];
    const result = selectCanonicalCommands(baseSignals(), commands, none);
    expect(result).toEqual([
      { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
      { kind: "lint", command: "npm run lint", source: "package.json", confidence: "high", scope: "." },
    ]);
  });

  it("ignores nested workspace manifests when picking root commands", () => {
    const commands: CommandEntry[] = [
      { source: "pnpm", invocation: "pnpm --dir apps/web run test", manifestPath: "apps/web/package.json" },
    ];
    expect(selectCanonicalCommands(baseSignals(), commands, none)).toEqual([]);
  });

  it("falls back to CI commands when no script matches", () => {
    const ci: CiCommand[] = [
      { command: "./mvnw -B verify", workflow: "build.yml" },
      { command: "./gradlew build", workflow: "build.yml" },
    ];
    const result = selectCanonicalCommands(baseSignals(), [], ci);
    expect(result).toEqual([
      { kind: "test", command: "./mvnw -B verify", source: "ci: build.yml", confidence: "high", scope: "." },
      { kind: "build", command: "./gradlew build", source: "ci: build.yml", confidence: "high", scope: "." },
    ]);
  });

  it("prefers a manifest script over a CI command of the same kind", () => {
    const commands: CommandEntry[] = [{ source: "npm", invocation: "npm test", detail: "vitest run" }];
    const ci: CiCommand[] = [{ command: "npm test -- --coverage", workflow: "ci.yml" }];
    const result = selectCanonicalCommands(baseSignals(), commands, ci);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("npm test");
    expect(result[0].source).toBe("package.json");
  });

  it("recognizes uv-run pytest in CI", () => {
    const ci: CiCommand[] = [{ command: "uv run pytest", workflow: "tests.yml" }];
    expect(selectCanonicalCommands(baseSignals(), [], ci)).toEqual([
      { kind: "test", command: "uv run pytest", source: "ci: tests.yml", confidence: "high", scope: "." },
    ]);
  });
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npx vitest run test/canonical-commands.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 4: Implementar el módulo**

`packages/cli/src/core/canonical-commands.ts`:

```typescript
import type {
  CanonicalCommand,
  CiCommand,
  CommandEntry,
  CommandSource,
  RepoSignals,
} from "./types.js";

export const SOURCE_FILES: Record<CommandSource, string> = {
  npm: "package.json",
  pnpm: "package.json",
  yarn: "package.json",
  bun: "package.json",
  composer: "composer.json",
  make: "Makefile",
  mix: "mix.exs",
  tox: "tox.ini",
};

const KIND_ORDER: CanonicalCommand["kind"][] = ["test", "lint", "build", "format", "typecheck"];

// Nombre de script → kind. Solo nombres inequívocos; "check" o "ci" quedan fuera a propósito.
const SCRIPT_KINDS: Record<string, CanonicalCommand["kind"]> = {
  test: "test",
  lint: "lint",
  build: "build",
  format: "format",
  fmt: "format",
  typecheck: "typecheck",
  "type-check": "typecheck",
};

function scriptName(entry: CommandEntry): string {
  const parts = entry.invocation.split(" ");
  return parts[parts.length - 1];
}

function isRootManifest(entry: CommandEntry): boolean {
  return entry.manifestPath === undefined || entry.manifestPath === "package.json";
}

function fromScripts(commands: CommandEntry[]): CanonicalCommand[] {
  const found: CanonicalCommand[] = [];
  for (const entry of commands) {
    if (!isRootManifest(entry)) continue;
    const kind = SCRIPT_KINDS[scriptName(entry)];
    if (!kind || found.some((c) => c.kind === kind)) continue;
    found.push({
      kind,
      command: entry.invocation,
      source: entry.manifestPath ?? SOURCE_FILES[entry.source],
      confidence: "high",
      scope: ".",
    });
  }
  return found;
}

// El comando de CI se conserva textual (evidencia), solo se clasifica su kind.
const CI_PATTERNS: [RegExp, CanonicalCommand["kind"]][] = [
  [/^(?:npm|pnpm|yarn|bun)(?: run)? test\b/, "test"],
  [/^(?:npm|pnpm|yarn|bun) run lint\b/, "lint"],
  [/^(?:npm|pnpm|yarn|bun) run build\b/, "build"],
  [/^(?:npm|pnpm|yarn|bun) run (?:format|fmt)\b/, "format"],
  [/^(?:npm|pnpm|yarn|bun) run (?:typecheck|type-check)\b/, "typecheck"],
  [/^\.[\\/]mvnw\b.*\b(?:verify|test)\b/, "test"],
  [/^\.[\\/]mvnw\b.*\bpackage\b/, "build"],
  [/^\.[\\/]gradlew\b.*\b(?:check|test)\b/, "test"],
  [/^\.[\\/]gradlew\b.*\b(?:build|assemble)\b/, "build"],
  [/^(?:uv run |poetry run )?pytest\b/, "test"],
  [/^tox\b/, "test"],
  [/^cargo test\b/, "test"],
  [/^go test\b/, "test"],
];

function fromCi(ciCommands: CiCommand[]): CanonicalCommand[] {
  const found: CanonicalCommand[] = [];
  for (const ci of ciCommands) {
    for (const [pattern, kind] of CI_PATTERNS) {
      if (!pattern.test(ci.command)) continue;
      if (found.some((c) => c.kind === kind)) break;
      found.push({
        kind,
        command: ci.command,
        source: `ci: ${ci.workflow}`,
        confidence: "high",
        scope: ".",
      });
      break;
    }
  }
  return found;
}

export function selectCanonicalCommands(
  signals: RepoSignals,
  commands: CommandEntry[],
  ciCommands: CiCommand[]
): CanonicalCommand[] {
  const byKind = new Map<CanonicalCommand["kind"], CanonicalCommand>();
  for (const candidate of [...fromScripts(commands), ...fromCi(ciCommands)]) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, candidate);
  }
  return KIND_ORDER.flatMap((kind) => byKind.get(kind) ?? []);
}
```

En `packages/cli/src/core/templates.ts`, borrar la constante local `SOURCE_FILES` e importarla:

```typescript
import { SOURCE_FILES } from "./canonical-commands.js";
```

- [ ] **Step 5: Verificar que los tests pasan**

Run: `npx vitest run test/canonical-commands.test.ts` y `npm run lint` (raíz)
Expected: PASS y typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/core/types.ts packages/cli/src/core/canonical-commands.ts packages/cli/src/core/templates.ts packages/cli/src/core/repo-facts.ts packages/cli/test/canonical-commands.test.ts
git commit -m "feat(core): canonical command selection from manifest scripts and CI"
```

---

### Task 5: (Fase 2) Fallbacks canónicos por señales de lenguaje

Cubre wrappers Java, uv/poetry+pytest y tox cuando no hay scripts ni CI que decidan.

**Files:**
- Modify: `packages/cli/src/core/canonical-commands.ts`
- Test: `packages/cli/test/canonical-commands.test.ts`

**Interfaces:**
- Consumes: `RepoSignals` (campos `pomXml`, `buildGradle`, `pyprojectToml`, `requirementsTxt`, `environmentYml`, `toxIni`, `hasFile`).
- Produces: misma función `selectCanonicalCommands`, ahora con tercera fuente `fromSignals` de menor prioridad.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `packages/cli/test/canonical-commands.test.ts`:

```typescript
describe("selectCanonicalCommands language fallbacks", () => {
  it("uses the Maven wrapper when present", () => {
    const signals = baseSignals({ pomXml: "<project/>", hasFile: (p) => p === "mvnw" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "./mvnw test", source: "mvnw", confidence: "high", scope: "." },
    ]);
  });

  it("uses plain mvn only when no wrapper exists", () => {
    const signals = baseSignals({ pomXml: "<project/>" });
    expect(selectCanonicalCommands(signals, [], none)[0]).toMatchObject({
      command: "mvn test", source: "pom.xml", confidence: "low",
    });
  });

  it("prefers uv run pytest when uv.lock and pytest are present", () => {
    const signals = baseSignals({
      pyprojectToml: '[project]\nname = "x"\n[project.optional-dependencies]\ndev = ["pytest"]\n',
      hasFile: (p) => p === "uv.lock",
    });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "uv run pytest", source: "uv.lock", confidence: "high", scope: "." },
    ]);
  });

  it("falls back to tox when only tox.ini decides", () => {
    const signals = baseSignals({ requirementsTxt: "flask\n", toxIni: "[tox]\nenv_list = py311\n" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." },
    ]);
  });

  it("CI beats a signal fallback", () => {
    const signals = baseSignals({ pomXml: "<project/>", hasFile: (p) => p === "mvnw" });
    const ci: CiCommand[] = [{ command: "./mvnw -B verify", workflow: "build.yml" }];
    const result = selectCanonicalCommands(signals, [], ci);
    expect(result[0].command).toBe("./mvnw -B verify");
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run test/canonical-commands.test.ts`
Expected: FAIL — los fallbacks no existen.

- [ ] **Step 3: Implementar `fromSignals`**

Añadir a `canonical-commands.ts`:

```typescript
function fromSignals(signals: RepoSignals): CanonicalCommand[] {
  const out: CanonicalCommand[] = [];

  if (signals.pomXml) {
    const hasWrapper = signals.hasFile("mvnw") || signals.hasFile("mvnw.cmd");
    out.push({
      kind: "test",
      command: hasWrapper ? "./mvnw test" : "mvn test",
      source: hasWrapper ? "mvnw" : "pom.xml",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  } else if (signals.buildGradle) {
    const hasWrapper = signals.hasFile("gradlew") || signals.hasFile("gradlew.bat");
    out.push({
      kind: "test",
      command: hasWrapper ? "./gradlew test" : "gradle test",
      source: hasWrapper ? "gradlew" : "build.gradle",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  }

  const pythonManifest = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  const hasPytest = pythonManifest !== undefined && /\bpytest\b/i.test(pythonManifest);
  if (hasPytest && signals.hasFile("uv.lock")) {
    out.push({ kind: "test", command: "uv run pytest", source: "uv.lock", confidence: "high", scope: "." });
  } else if (hasPytest && signals.hasFile("poetry.lock")) {
    out.push({ kind: "test", command: "poetry run pytest", source: "poetry.lock", confidence: "high", scope: "." });
  } else if (signals.toxIni) {
    out.push({ kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." });
  } else if (hasPytest) {
    out.push({ kind: "test", command: "pytest", source: "pyproject.toml", confidence: "low", scope: "." });
  }

  return out;
}
```

y en `selectCanonicalCommands` cambiar la lista de candidatos a:

```typescript
  for (const candidate of [...fromScripts(commands), ...fromCi(ciCommands), ...fromSignals(signals)]) {
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run test/canonical-commands.test.ts`
Expected: PASS (incluidos los tests de la Task 4, sin regresión).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/canonical-commands.ts packages/cli/test/canonical-commands.test.ts
git commit -m "feat(core): canonical test command fallbacks from build wrappers and Python tooling"
```

---

### Task 6: (Fase 2) Integrar comandos canónicos en RepoFacts, render y --json

**Files:**
- Modify: `packages/cli/src/core/repo-facts.ts` (`buildRepoFacts`)
- Modify: `packages/cli/src/core/templates.ts` (`renderRepoFacts`)
- Modify: `packages/cli/src/core/i18n.ts` (sección nueva en `UiTexts.sections`)
- Modify: `packages/cli/src/cli.ts` (`RunCliOptions.onFacts`, campo `facts` en el JSON)
- Test: `packages/cli/test/repo-facts.test.ts`, `packages/cli/test/templates.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `selectCanonicalCommands` (Tasks 4–5).
- Produces:
  - `buildRepoFacts` rellena `facts.canonical` de verdad.
  - `renderRepoFacts` emite la sección `## Comandos canónicos` / `## Canonical commands` (solo entradas `confidence === "high"`), antes de la sección de comandos.
  - `RunCliOptions.onFacts?: (facts: RepoFacts) => void` y salida `--json` con campo `facts` (el objeto `RepoFacts` completo).

- [ ] **Step 1: Tests que fallan**

En `packages/cli/test/repo-facts.test.ts` añadir:

```typescript
it("fills canonical commands from the extracted scripts", () => {
  const signals = baseSignals({
    packageJson: {
      dependencies: {}, devDependencies: {}, moduleType: "commonjs",
      scripts: { test: "mocha", lint: "eslint ." },
    },
  });
  const facts = buildRepoFacts(signals, "en");
  expect(facts.canonical).toEqual([
    { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
    { kind: "lint", command: "npm run lint", source: "package.json", confidence: "high", scope: "." },
  ]);
});
```

(Usar el helper `baseSignals` que ya exista en ese archivo de test; si no existe, copiar el de `canonical-commands.test.ts`.)

En `packages/cli/test/templates.test.ts` añadir:

```typescript
it("renders a canonical commands section with provenance, high confidence only", () => {
  const facts: RepoFacts = {
    commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0,
    canonical: [
      { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
      { kind: "build", command: "gradle build", source: "build.gradle", confidence: "low", scope: "." },
    ],
  };
  const output = renderRepoFacts(facts, "en");
  expect(output).toContain("## Canonical commands");
  expect(output).toContain("- test: `npm test` (package.json)");
  expect(output).not.toContain("gradle build");
});
```

En `packages/cli/test/cli.test.ts` añadir un test de que `runCli` entrega los facts:

```typescript
it("exposes repo facts through onFacts", async () => {
  let facts: RepoFacts | undefined;
  await runCli(expressFixturePath, {
    dryRun: true, nonInteractive: true, skipLlm: true, lang: "en",
    onFacts: (f) => { facts = f; },
  });
  expect(facts?.canonical.some((c) => c.kind === "test" && c.command === "npm test")).toBe(true);
});
```

(donde `expressFixturePath` apunta a `fixtures/node-express-mocha`, siguiendo el patrón de rutas ya usado en `corpus.test.ts`).

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run test/repo-facts.test.ts test/templates.test.ts test/cli.test.ts`
Expected: FAIL (canonical vacío, sección ausente, `onFacts` inexistente).

- [ ] **Step 3: Implementar**

`repo-facts.ts` — importar y usar:

```typescript
import { selectCanonicalCommands } from "./canonical-commands.js";
```

y en `buildRepoFacts`, sustituir el `canonical: []` provisional por:

```typescript
    canonical: selectCanonicalCommands(signals, kept, ciCommands),
```

`i18n.ts` — en `UiTexts.sections` añadir `canonical: string;` y en ambos idiomas:

```typescript
      canonical: "Comandos canónicos",   // es
      canonical: "Canonical commands",   // en
```

`templates.ts` — en `renderRepoFacts`, antes del bloque de `facts.commands`:

```typescript
  const canonical = facts.canonical.filter((c) => c.confidence === "high");
  if (canonical.length > 0) {
    const lines = canonical.map((c) => `- ${c.kind}: \`${c.command}\` (${c.source})`);
    sections.push([`## ${ui.sections.canonical}`, "", ...lines].join("\n"));
  }
```

`cli.ts` — en `RunCliOptions` añadir:

```typescript
  /** Recibe los hechos extraídos del repo (comandos canónicos incluidos). */
  onFacts?: (facts: RepoFacts) => void;
```

(el tipo `RepoFacts` ya se importa en `cli.ts` vía `import type { Pack } from "./core/types.js"` — ampliar ese import a `import type { Pack, RepoFacts } from "./core/types.js"`). Tras `const facts = buildRepoFacts(signals, lang);` añadir `options.onFacts?.(facts);`. En `main()`, capturar:

```typescript
    let repoFacts: RepoFacts | undefined;
    const results = await runCli(process.cwd(), {
      // ...opciones existentes...
      onFacts: (facts) => { repoFacts = facts; },
    });
```

y en el `JSON.stringify` del modo `--json` añadir `facts: repoFacts,` tras `configWarnings`.

- [ ] **Step 4: Verificar tests y snapshots**

Run: `npx vitest run test/repo-facts.test.ts test/templates.test.ts test/cli.test.ts` — Expected: PASS.
Run: `npx vitest run test/corpus.test.ts -u` — Expected: los snapshots ganan la sección "Canonical commands"/"Comandos canónicos" con `npm test`, `uv run pytest`, `./mvnw -B verify`, `./gradlew build` según fixture.
Run (raíz): `npm test` y `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat(core): surface canonical commands in repo facts, rendered docs and --json"
```

---

### Task 7: (Fase 2) Rutas de tests y entrypoints en RepoFacts

Hechos mínimos de arquitectura para que los prompts puedan citar rutas reales.

**Files:**
- Modify: `packages/cli/src/core/types.ts` (`RepoFacts.testDirs`, `RepoFacts.entrypoints`, `PackageJsonManifest.main`)
- Modify: `packages/cli/src/core/scanner.ts` (leer `main` del package.json)
- Modify: `packages/cli/src/core/repo-facts.ts` (`detectTestDirs`, `detectEntrypoints`, integración en `buildRepoFacts`)
- Modify: `packages/cli/src/core/templates.ts` + `packages/cli/src/core/i18n.ts` (render dentro de la sección Estructura)
- Test: `packages/cli/test/repo-facts.test.ts`

**Interfaces:**
- Consumes: `RepoSignals.files`, `RepoSignals.packageJson.main`, `RepoSignals.pyprojectToml`.
- Produces:
  - `RepoFacts.testDirs: string[]` — rutas con barra final, orden alfabético, p. ej. `["test/", "test/acceptance/"]` o `["src/test/java/"]`.
  - `RepoFacts.entrypoints: { label: string; target: string; source: string }[]` — p. ej. `{ label: "main", target: "lib/app.js", source: "package.json" }`, `{ label: "fixture-app", target: "fixture_app.cli:main", source: "pyproject.toml" }`.
  - `detectTestDirs(files: string[]): string[]` y `detectEntrypoints(signals: RepoSignals): RepoFacts["entrypoints"]` exportadas desde `repo-facts.ts`.

- [ ] **Step 1: Tests que fallan**

Añadir a `packages/cli/test/repo-facts.test.ts`:

```typescript
describe("detectTestDirs", () => {
  it("finds top-level test dirs and their first-level children", () => {
    expect(detectTestDirs([
      "lib/app.js",
      "test/app.test.js",
      "test/acceptance/routes.test.js",
    ])).toEqual(["test/", "test/acceptance/"]);
  });

  it("finds the Maven test layout", () => {
    expect(detectTestDirs([
      "src/main/java/demo/App.java",
      "src/test/java/demo/AppTest.java",
    ])).toEqual(["src/test/", "src/test/java/"]);
  });

  it("returns nothing when no test dir exists", () => {
    expect(detectTestDirs(["lib/app.js", "README.md"])).toEqual([]);
  });
});

describe("detectEntrypoints", () => {
  it("reads package.json main", () => {
    const signals = baseSignals({
      packageJson: {
        main: "lib/app.js", dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs",
      },
    });
    expect(detectEntrypoints(signals)).toEqual([
      { label: "main", target: "lib/app.js", source: "package.json" },
    ]);
  });

  it("reads pyproject [project.scripts]", () => {
    const signals = baseSignals({
      pyprojectToml: '[project]\nname = "x"\n\n[project.scripts]\nfixture-app = "fixture_app.cli:main"\n',
    });
    expect(detectEntrypoints(signals)).toEqual([
      { label: "fixture-app", target: "fixture_app.cli:main", source: "pyproject.toml" },
    ]);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run test/repo-facts.test.ts`
Expected: FAIL — funciones inexistentes.

- [ ] **Step 3: Implementar**

`types.ts`: en `PackageJsonManifest` añadir `main?: string;`. En `RepoFacts` añadir:

```typescript
  testDirs: string[];
  entrypoints: { label: string; target: string; source: string }[];
```

`scanner.ts`: en `toPackageJsonManifest` añadir al objeto devuelto:

```typescript
    main: typeof raw.main === "string" ? raw.main : undefined,
```

y en la construcción de `packageJson` (el agregado raíz) añadir `main: primaryPackageJson.main,`.

`repo-facts.ts`:

```typescript
const TEST_DIR_NAMES = new Set(["test", "tests", "spec", "specs", "__tests__"]);

export function detectTestDirs(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const segments = file.split(/[\\/]/).slice(0, -1);
    for (let i = 0; i < segments.length; i++) {
      if (TEST_DIR_NAMES.has(segments[i].toLowerCase())) {
        dirs.add(segments.slice(0, i + 1).join("/") + "/");
        // También el subdirectorio inmediato (test/acceptance/, src/test/java/),
        // pero no más profundo.
        if (segments.length > i + 1) dirs.add(segments.slice(0, i + 2).join("/") + "/");
        break;
      }
    }
  }
  return [...dirs].sort();
}

export function detectEntrypoints(signals: RepoSignals): RepoFacts["entrypoints"] {
  const out: RepoFacts["entrypoints"] = [];
  if (signals.packageJson?.main) {
    out.push({ label: "main", target: signals.packageJson.main, source: "package.json" });
  }
  const scriptsSection = signals.pyprojectToml?.match(/\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (scriptsSection) {
    for (const match of scriptsSection.matchAll(/^\s*([\w.-]+)\s*=\s*["']([^"']+)["']/gm)) {
      out.push({ label: match[1], target: match[2], source: "pyproject.toml" });
    }
  }
  return out;
}
```

En `buildRepoFacts`, añadir al objeto devuelto:

```typescript
    testDirs: detectTestDirs(signals.files),
    entrypoints: detectEntrypoints(signals),
```

Nota: `detectTestDirs` con `break` en el primer match evita duplicar `tests/unit/data/` en profundidad; el caso `src/test` se evalúa aparte porque "test" sí está en la lista y habría hecho `break` — comprobar con el test de Maven que el resultado es exactamente `["src/test/", "src/test/java/"]`… **no**: el bucle con `break` sobre `src/test/java` añade `src/test/` y `src/test/java/`. Ajustar el test de Maven a ese resultado o filtrar: mantener simple y asertar `["src/test/", "src/test/java/"]` en el test del Step 1 (actualizar la aserción) y eliminar el bloque extra de layout Maven (el bucle general ya lo cubre).

`templates.ts` — dentro del bloque de `facts.structure` en `renderRepoFacts`, tras las líneas de directorios:

```typescript
    for (const dir of facts.testDirs) {
      if (!facts.structure.some((d) => d.dir === dir)) lines.push(`- \`${dir}\` — ${ui.testDirNote}`);
    }
    for (const entry of facts.entrypoints) {
      lines.push(`- ${ui.entrypointNote}: \`${entry.target}\` (${entry.source} "${entry.label}")`);
    }
```

y cambiar la condición de la sección Estructura a `if (facts.structure.length > 0 || facts.testDirs.length > 0 || facts.entrypoints.length > 0)`.

`i18n.ts` — añadir a `UiTexts`: `testDirNote: string; entrypointNote: string;` con valores `es`: `"tests"` / `"punto de entrada"`, `en`: `"tests"` / `"entry point"`.

- [ ] **Step 4: Verificar tests, snapshots y suite**

Run: `npx vitest run test/repo-facts.test.ts` — Expected: PASS.
Run: `npx vitest run test/corpus.test.ts -u` — Expected: la Estructura de los fixtures gana `test/acceptance/`, `src/test/java/` y entrypoints (`lib/app.js`, `fixture_app.cli:main`).
Run (raíz): `npm test` && `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat(core): extract test directories and entrypoints into repo facts"
```

---

### Task 8: (Fase 3) Contexto de hechos en el contrato de packs + js-ts enriquecido

**Files:**
- Modify: `packages/cli/src/core/types.ts` (`PackContext`, firmas de `Pack`)
- Modify: `packages/cli/src/cli.ts` (pasar `ctx` a `rules` y `promptTemplates`)
- Modify: `packages/cli/src/packs/js-ts.ts` (prompts y rules enriquecidos)
- Test: `packages/cli/test/packs/js-ts.test.ts`

**Interfaces:**
- Consumes: `RepoFacts` completo (Tasks 6–7).
- Produces:
  - `export interface PackContext { facts: RepoFacts; }` en `types.ts`.
  - `Pack.rules(detection, lang, ctx?: PackContext)` y `Pack.promptTemplates(detection, lang, ctx?: PackContext)` — parámetro opcional: los packs no migrados siguen compilando sin cambios.
  - Helper local en js-ts: `canonicalOf(ctx, kind)` que devuelve `CanonicalCommand | undefined`.

- [ ] **Step 1: Cambiar el contrato**

En `types.ts`:

```typescript
export interface PackContext {
  facts: RepoFacts;
}

export interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet;
  promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[];
}
```

En `cli.ts`, donde se construyen `entries` y los prompt files:

```typescript
  const ctx = { facts };
  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection, lang, ctx) };
  });
```

y más abajo `pack.promptTemplates(detection, lang, ctx)`.

Run: `npm run lint` (raíz) — Expected: compila (el parámetro es opcional).

- [ ] **Step 2: Tests que fallan para js-ts enriquecido**

Añadir a `packages/cli/test/packs/js-ts.test.ts`:

```typescript
import { buildRepoFacts } from "../../src/core/repo-facts.js";

function expressLikeSignalsAndDetection() {
  const signals = baseSignals({
    files: ["lib/app.js", "test/app.test.js", "test/acceptance/routes.test.js", "package-lock.json"],
    hasFile: (p) => p === "package-lock.json",
    packageJson: {
      main: "lib/app.js",
      dependencies: { express: "^4.19.0" },
      devDependencies: { mocha: "^10.4.0", eslint: "^9.0.0" },
      scripts: { test: "mocha --recursive test/", lint: "eslint lib/ test/" },
      moduleType: "commonjs",
    },
  });
  const detection = jsTsPack.detect(signals)!;
  const ctx = { facts: buildRepoFacts(signals, "en") };
  return { detection, ctx };
}

describe("enriched js-ts prompts", () => {
  it("review prompt cites real commands, paths and module format", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const review = jsTsPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "review")!;
    expect(review.body).toContain("`npm test`");
    expect(review.body).toContain("`npm run lint`");
    expect(review.body).toContain("`test/`");
    expect(review.body).toContain("CommonJS");
    expect(review.body).toContain("next(err)");
    expect(review.body).not.toMatch(/typing|tipado/i);
  });

  it("testing prompt uses the canonical test command and real test dirs", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const testing = jsTsPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "testing")!;
    expect(testing.body).toContain("`npm test`");
    expect(testing.body).toContain("`test/`");
  });

  it("rules use the canonical test command instead of the runner name", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const ruleSet = jsTsPack.rules(detection, "en", ctx);
    expect(ruleSet.conventions.join("\n")).toContain("npm test");
  });

  it("prompts still render without a context (backwards compatible)", () => {
    const { detection } = expressLikeSignalsAndDetection();
    const templates = jsTsPack.promptTemplates(detection, "en");
    expect(templates).toHaveLength(3);
  });
});
```

Run: `npx vitest run test/packs/js-ts.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar el enriquecimiento en js-ts**

En `packages/cli/src/packs/js-ts.ts`:

Añadir imports/tipos:

```typescript
import type { CanonicalCommand, PackContext } from "../core/types.js";

function canonicalOf(ctx: PackContext | undefined, kind: CanonicalCommand["kind"]): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}
```

Añadir riesgos por framework (solo los que tienen texto; el resto omite la frase):

```typescript
const FRAMEWORK_RISKS: Record<string, Record<Lang, string>> = {
  express: {
    es: "Presta especial atención al flujo de middleware, la propagación de errores con `next(err)` y el ciclo de vida de la respuesta.",
    en: "Pay special attention to middleware control flow, error propagation through `next(err)` and response lifecycle handling.",
  },
  react: {
    es: "Presta especial atención a las dependencias de hooks (`useEffect`), renders innecesarios y estado derivado.",
    en: "Pay special attention to hook dependencies (`useEffect`), unnecessary re-renders and derived state.",
  },
  next: {
    es: "Presta especial atención a la frontera servidor/cliente (`use client`), el data fetching y el caché de rutas.",
    en: "Pay special attention to the server/client boundary (`use client`), data fetching and route caching.",
  },
  nestjs: {
    es: "Presta especial atención a los scopes de providers, la inyección de dependencias y los pipes de validación.",
    en: "Pay special attention to provider scopes, dependency injection and validation pipes.",
  },
  fastify: {
    es: "Presta especial atención al ciclo de vida de plugins, la encapsulación y los schemas de validación.",
    en: "Pay special attention to plugin lifecycle, encapsulation and validation schemas.",
  },
};
```

Reemplazar `promptTemplates` por una versión que compone el cuerpo con hechos (manteniendo `reviewBody`/`testingBody` como fallback sin `ctx`):

```typescript
function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const focus = detection.usesTypeScript ? t.reviewFocusTs : t.reviewFocusJs;
  const test = canonicalOf(ctx, "test");
  const lint = canonicalOf(ctx, "lint");
  const testDirs = ctx?.facts.testDirs ?? [];

  const es = lang === "es";
  const reviewParts: string[] = [];
  const moduleLabel = detection.moduleFormat === "commonjs" ? "CommonJS" : detection.moduleFormat === "module" ? "ESM" : undefined;
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones${moduleLabel ? ` ${moduleLabel}` : ""} de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's${moduleLabel ? ` ${moduleLabel}` : ""} conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test || lint) {
    const commands = [test, lint].filter((c): c is CanonicalCommand => c !== undefined);
    const list = commands.map((c) => `\`${c.command}\``).join(es ? " y " : " and ");
    reviewParts.push(es ? `Ejecuta ${list} antes de dar por buena la revisión.` : `Run ${list} before approving the review.`);
  }
  const risk = framework ? FRAMEWORK_RISKS[framework]?.[lang] : undefined;
  if (risk) reviewParts.push(risk);
  reviewParts.push(es ? `Busca también bugs: ${focus}.` : `Also look for bugs: ${focus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(
    es
      ? "Señala solo hallazgos concretos con archivo y línea."
      : "Report only concrete findings with file and line references."
  );

  const testingParts: string[] = [];
  testingParts.push(testingBody(lang, runner));
  if (test) {
    testingParts.push(
      es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`
    );
  }
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    {
      id: "review",
      title: "Code Review (JS/TS)",
      body: ctx ? reviewParts.join(" ") : reviewBody(lang, focus, framework),
    },
    { id: "refactor", title: "Refactor (JS/TS)", body: refactorBody(lang, detection.usesTypeScript ? t.refactorExtra : undefined) },
    { id: "testing", title: "Testing (JS/TS)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}
```

Y en `rules`, usar el comando canónico:

```typescript
function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const testCmd = canonicalOf(ctx, "test")?.command ?? runner;
  const conventions: string[] = [];
  if (detection.usesTypeScript) conventions.push(t.tsStrict);
  conventions.push(runTestsConvention(lang, testCmd));
  if (detection.moduleFormat) {
    conventions.push(detection.moduleFormat === "module" ? t.esModules : t.commonJs);
  }
  return {
    summary: summarySentence(lang, detection.usesTypeScript ? "TypeScript" : "JavaScript", framework),
    conventions,
    architectureNotes: t.arch,
  };
}
```

Nota: `refactorBody(lang, ...)` ahora solo añade "Respeta los tipos existentes" cuando hay TypeScript — es parte de la Fase 1 (no mencionar tipos en JS).

- [ ] **Step 4: Verificar tests, snapshots y suite**

Run: `npx vitest run test/packs/js-ts.test.ts` — Expected: PASS.
Run: `npx vitest run test/corpus.test.ts -u && npx vitest run test/no-sentinels.test.ts` — Expected: el prompt de review del fixture Express-like se parece al ejemplo del roadmap (CommonJS, `npm test`, `npm run lint`, `next(err)`, `test/`, `test/acceptance/`); sin sentinelas.
Run (raíz): `npm test` && `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat(js-ts): fact-driven review and testing prompts with real commands and paths"
```

---

### Task 9: (Fase 3) Python enriquecido

**Files:**
- Modify: `packages/cli/src/packs/python.ts`
- Test: `packages/cli/test/packs/python.test.ts`

**Interfaces:**
- Consumes: `PackContext` (Task 8), `canonicalOf` (copiar el helper local de 3 líneas; no compartirlo todavía — con el tercer pack, Task 10, se decide si extraerlo a `core`).
- Produces: `pythonPack.rules`/`promptTemplates` aceptando `ctx?: PackContext`.

- [ ] **Step 1: Tests que fallan**

Añadir a `packages/cli/test/packs/python.test.ts` (usar/crear helper `baseSignals` idéntico al de js-ts.test.ts):

```typescript
import { buildRepoFacts } from "../../src/core/repo-facts.js";

function flaskLikeSignalsAndDetection() {
  const signals = baseSignals({
    files: ["src/fixture_app/cli.py", "tests/test_cli.py", "uv.lock", "tox.ini"],
    hasFile: (p) => p === "uv.lock",
    pyprojectToml:
      '[project]\nname = "app"\ndependencies = ["flask"]\n\n[project.optional-dependencies]\ndev = ["pytest"]\n',
    toxIni: "[tox]\nenv_list = py311, style\n",
  });
  const detection = pythonPack.detect(signals)!;
  const ctx = { facts: buildRepoFacts(signals, "en") };
  return { detection, ctx };
}

describe("enriched python prompts", () => {
  it("review prompt cites the uv-based flow and real paths", () => {
    const { detection, ctx } = flaskLikeSignalsAndDetection();
    const review = pythonPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "review")!;
    expect(review.body).toContain("`uv run pytest`");
    expect(review.body).toContain("`tests/`");
    expect(review.body).toMatch(/tox/);
  });

  it("rules recommend the canonical command, not just the runner name", () => {
    const { detection, ctx } = flaskLikeSignalsAndDetection();
    const ruleSet = pythonPack.rules(detection, "en", ctx);
    expect(ruleSet.conventions.join("\n")).toContain("uv run pytest");
    expect(ruleSet.conventions.join("\n")).not.toMatch(/with pytest before/);
  });

  it("prompts still render without a context", () => {
    const { detection } = flaskLikeSignalsAndDetection();
    expect(pythonPack.promptTemplates(detection, "en")).toHaveLength(3);
  });
});
```

Run: `npx vitest run test/packs/python.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implementar**

En `packages/cli/src/packs/python.ts`, añadir el helper y riesgos:

```typescript
import type { CanonicalCommand, PackContext } from "../core/types.js";

function canonicalOf(ctx: PackContext | undefined, kind: CanonicalCommand["kind"]): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}

const FRAMEWORK_RISKS: Record<string, Record<Lang, string>> = {
  flask: {
    es: "Presta especial atención al contexto de aplicación/petición, los blueprints y el manejo de errores HTTP.",
    en: "Pay special attention to application/request context, blueprints and HTTP error handling.",
  },
  django: {
    es: "Presta especial atención a migraciones pendientes, consultas N+1 del ORM y validación en forms/serializers.",
    en: "Pay special attention to pending migrations, ORM N+1 queries and validation in forms/serializers.",
  },
  fastapi: {
    es: "Presta especial atención a los modelos Pydantic, las dependencias async y los códigos de respuesta declarados.",
    en: "Pay special attention to Pydantic models, async dependencies and declared response codes.",
  },
};
```

Reemplazar `rules` y `promptTemplates`:

```typescript
function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const testCmd = canonicalOf(ctx, "test")?.command ?? runner;
  return {
    summary: summarySentence(lang, "Python", framework),
    conventions: [t.style, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const test = canonicalOf(ctx, "test");
  const testDirs = ctx?.facts.testDirs ?? [];
  const hasTox = ctx?.facts.commands.some((c) => c.source === "tox") ?? false;
  const es = lang === "es";

  const reviewParts: string[] = [];
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones Python de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's Python conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test) {
    reviewParts.push(es ? `Ejecuta \`${test.command}\` antes de dar por buena la revisión.` : `Run \`${test.command}\` before approving the review.`);
  }
  if (hasTox) {
    reviewParts.push(es ? "La matriz completa de entornos se ejecuta con tox (`tox.ini`)." : "The full environment matrix runs through tox (`tox.ini`).");
  }
  const risk = framework ? FRAMEWORK_RISKS[framework]?.[lang] : undefined;
  if (risk) reviewParts.push(risk);
  reviewParts.push(es ? `Busca también bugs: ${t.reviewFocus}.` : `Also look for bugs: ${t.reviewFocus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(es ? "Señala solo hallazgos concretos con archivo y línea." : "Report only concrete findings with file and line references.");

  const testingParts: string[] = [testingBody(lang, runner)];
  if (test) testingParts.push(es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    { id: "review", title: "Code Review (Python)", body: ctx ? reviewParts.join(" ") : reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Python)", body: refactorBody(lang, t.refactorExtra) },
    { id: "testing", title: "Testing (Python)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}
```

(`TEXTS` conserva su clave `reviewFocus` actual en python — aquí no hay problema de tipado JS/TS.)

- [ ] **Step 3: Verificar tests, snapshots y suite**

Run: `npx vitest run test/packs/python.test.ts` — Expected: PASS.
Run: `npx vitest run test/corpus.test.ts -u && npx vitest run` — Expected: el fixture `python-uv-tox` recomienda `uv run pytest`, menciona tox y `tests/`; suite completa PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/packs/python.ts packages/cli/test/packs/python.test.ts packages/cli/test/__snapshots__/
git commit -m "feat(python): fact-driven prompts with canonical uv/tox commands and real paths"
```

---

### Task 10: (Fase 3) Java enriquecido

**Files:**
- Modify: `packages/cli/src/packs/java.ts`
- Test: `packages/cli/test/packs/java.test.ts`

**Interfaces:**
- Consumes: `PackContext`; mismo helper local `canonicalOf` (tercera copia: extraerlo ahora a `packages/cli/src/core/canonical-commands.ts` como `export function canonicalOf(ctx: PackContext | undefined, kind: CanonicalCommand["kind"])` y actualizar js-ts.ts y python.ts para importarlo de ahí).
- Produces: `javaPack.rules`/`promptTemplates` con `ctx?: PackContext`.

- [ ] **Step 1: Extraer `canonicalOf` a core**

En `canonical-commands.ts`:

```typescript
import type { PackContext } from "./types.js";

export function canonicalOf(
  ctx: PackContext | undefined,
  kind: CanonicalCommand["kind"]
): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}
```

Borrar las copias locales de `js-ts.ts` y `python.ts` y sustituirlas por `import { canonicalOf } from "../core/canonical-commands.js";`.

Run: `npm run lint` (raíz) — Expected: limpio.

- [ ] **Step 2: Tests que fallan**

Añadir a `packages/cli/test/packs/java.test.ts` (con helper `baseSignals` como en los otros tests):

```typescript
import { buildRepoFacts } from "../../src/core/repo-facts.js";

function petclinicLikeSignalsAndDetection() {
  const signals = baseSignals({
    files: [
      "pom.xml", "mvnw", "build.gradle", "gradlew",
      "src/main/java/demo/App.java", "src/test/java/demo/AppTest.java",
    ],
    hasFile: (p) => ["mvnw", "mvnw.cmd", "gradlew"].includes(p),
    pomXml: "<project>spring junit</project>",
    buildGradle: "plugins { id 'java' }",
    githubWorkflows: [{
      path: ".github/workflows/build.yml",
      content: "jobs:\n  maven:\n    steps:\n      - run: ./mvnw -B verify\n  gradle:\n    steps:\n      - run: ./gradlew build\n",
    }],
  });
  const detection = javaPack.detect(signals)!;
  const ctx = { facts: buildRepoFacts(signals, "en") };
  return { detection, ctx };
}

describe("enriched java prompts", () => {
  it("review prompt cites the wrapper command from CI and the Maven test layout", () => {
    const { detection, ctx } = petclinicLikeSignalsAndDetection();
    const review = javaPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "review")!;
    expect(review.body).toContain("`./mvnw -B verify`");
    expect(review.body).toContain("src/test/");
    expect(review.body).toMatch(/gradlew build/);
  });

  it("rules use the canonical command", () => {
    const { detection, ctx } = petclinicLikeSignalsAndDetection();
    const ruleSet = javaPack.rules(detection, "en", ctx);
    expect(ruleSet.conventions.join("\n")).toContain("./mvnw -B verify");
  });

  it("prompts still render without a context", () => {
    const { detection } = petclinicLikeSignalsAndDetection();
    expect(javaPack.promptTemplates(detection, "en")).toHaveLength(3);
  });
});
```

Run: `npx vitest run test/packs/java.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

En `packages/cli/src/packs/java.ts`:

```typescript
import { canonicalOf } from "../core/canonical-commands.js";
import type { PackContext } from "../core/types.js";

const SPRING_RISK: Record<Lang, string> = {
  es: "Presta especial atención a los límites de transacción (@Transactional), la inyección de dependencias y la separación controller/service/repository.",
  en: "Pay special attention to transaction boundaries (@Transactional), dependency injection and the controller/service/repository separation.",
};
```

Reemplazar `rules`:

```typescript
function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const wrapperCmd = detection.packageManager?.value === "maven wrapper"
    ? "./mvnw test"
    : detection.packageManager?.value === "maven"
    ? "mvn test"
    : detection.packageManager?.value === "gradle wrapper"
    ? "./gradlew test"
    : "gradle test";
  const testCmd = canonicalOf(ctx, "test")?.command ?? wrapperCmd;
  return {
    summary: summarySentence(lang, "Java", framework, detection.packageManager?.value),
    conventions: [t.naming, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}
```

Reemplazar `promptTemplates`:

```typescript
function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const test = canonicalOf(ctx, "test");
  const build = canonicalOf(ctx, "build");
  const testDirs = ctx?.facts.testDirs ?? [];
  const es = lang === "es";

  const reviewParts: string[] = [];
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones Java de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's Java conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test) {
    reviewParts.push(es ? `Ejecuta \`${test.command}\` antes de dar por buena la revisión.` : `Run \`${test.command}\` before approving the review.`);
  }
  if (build && build.command !== test?.command) {
    reviewParts.push(es ? `CI también ejecuta \`${build.command}\`.` : `CI also runs \`${build.command}\`.`);
  }
  if (framework === "spring") reviewParts.push(SPRING_RISK[lang]);
  reviewParts.push(es ? `Busca también bugs: ${t.reviewFocus}.` : `Also look for bugs: ${t.reviewFocus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(es ? "Señala solo hallazgos concretos con archivo y línea." : "Report only concrete findings with file and line references.");

  const testingParts: string[] = [testingBody(lang, runner)];
  if (test) testingParts.push(es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    { id: "review", title: "Code Review (Java)", body: ctx ? reviewParts.join(" ") : reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Java)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Java)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}
```

- [ ] **Step 4: Verificar tests, snapshots y suite**

Run: `npx vitest run test/packs/java.test.ts` — Expected: PASS.
Run: `npx vitest run test/corpus.test.ts -u && npx vitest run` — Expected: el fixture `java-spring-maven` recomienda `./mvnw -B verify` (de CI), menciona `./gradlew build` y `src/test/`; suite completa PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat(java): fact-driven prompts with wrapper commands, dual builds and Maven test layout"
```

---

### Task 11: Verificación final de la definición de terminado (parcial)

**Files:**
- Modify: `packages/cli/test/corpus.test.ts` (aserciones de calidad sobre el corpus)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: suite verde, build y typecheck limpios, snapshots revisados.

- [ ] **Step 1: Añadir aserciones de calidad al corpus**

Añadir a `packages/cli/test/corpus.test.ts`:

```typescript
describe("content quality gates", () => {
  it("Express, Flask and Petclinic fixtures produce clearly distinct rules", async () => {
    const express = await renderCorpus("node-express-mocha", "en");
    const flask = await renderCorpus("python-uv-tox", "en");
    const petclinic = await renderCorpus("java-spring-maven", "en");
    const claude = (m: Map<string, string>) => m.get("CLAUDE.generated.md")!;
    expect(claude(express)).not.toBe(claude(flask));
    expect(claude(flask)).not.toBe(claude(petclinic));
    expect(claude(express)).toContain("npm test");
    expect(claude(flask)).toContain("uv run pytest");
    expect(claude(petclinic)).toContain("./mvnw");
  });

  it("every review prompt in the corpus contains at least one backticked command", async () => {
    for (const fixture of ["node-express-mocha", "python-uv-tox", "java-spring-maven"] as const) {
      const files = await renderCorpus(fixture, "en");
      const reviews = [...files.entries()].filter(([p]) => p.includes("-review.generated"));
      expect(reviews.length).toBeGreaterThan(0);
      for (const [, content] of reviews) {
        expect(content).toMatch(/`[^`]+`/);
      }
    }
  });

  it("a plain JavaScript fixture never mentions TypeScript", async () => {
    const files = await renderCorpus("node-express-mocha", "en");
    for (const [, content] of files) {
      expect(content).not.toMatch(/TypeScript/);
    }
  });
});
```

- [ ] **Step 2: Ejecutar toda la verificación**

Run (raíz): `npm run build && npm test && npm run lint`
Expected: build, suite completa (incluye corpus, no-sentinels, packs, estabilidad) y typecheck en verde.

- [ ] **Step 3: Revisar los snapshots a mano**

Leer `packages/cli/test/__snapshots__/corpus.test.ts.snap` completo y confirmar contra la "Definición de terminado" del roadmap: reglas distinguibles entre fixtures, comandos y rutas reales en cada prompt, cero sentinelas, procedencia en la sección de comandos canónicos. Si algo falla, es un bug de una task anterior: arreglarlo allí, no maquillar el snapshot.

- [ ] **Step 4: Commit final**

```bash
git add packages/cli/test
git commit -m "test: content quality gates over the fixture corpus"
```

---

## Fuera de alcance (plan posterior)

- Línea 2 completa (`ArchitectureFact` con `statement`/`evidence` generalizado; este plan solo aporta `testDirs` y `entrypoints`).
- Línea 3 completa (extraer convenciones de CONTRIBUTING.md, .editorconfig, configs de lint).
- Línea 6 / Fase 4 (renderizadores diferenciados por consumidor).
- Fase 5 completa (script no destructivo sobre clones públicos, check de calidad en CI).
- Extender el patrón de prompts enriquecidos a los 12 packs restantes.
- Bump de versión y publicación npm.
