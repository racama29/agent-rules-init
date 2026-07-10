# Diseño: hechos del repo en el contenido generado (RepoFacts)

Fecha: 2026-07-10. Estado: aprobado por el usuario (enfoque A).

## Problema

El contenido que genera `agent-rules-init` es consejo genérico por stack ("sigue
PEP 8", "cubre el camino feliz") que cualquier asistente de IA ya conoce. Lo que
hace valioso un CLAUDE.md/AGENTS.md son los hechos específicos del repo: los
comandos exactos que funcionan, la estructura de carpetas, lo que exige CI. El
scanner ya captura parte de esa información (p. ej. `packageJson.scripts`) y no
la usa.

## Decisiones de alcance (tomadas con el usuario)

1. **Contenido**: comandos reales + estructura de directorios + comandos de CI.
2. **Cobertura de comandos**: extractores dedicados solo donde hay scripts
   declarados de forma explícita (npm, composer, Makefile, mix, tox). Los demás
   stacks se benefician de estructura + CI. Nunca se inventan comandos.
3. **Estructura**: anotar únicamente directorios con significado convencional
   inequívoco (tabla fija, match exacto). Lo demás se lista sin anotar.
4. **CI**: solo GitHub Actions (`.github/workflows/*.yml|yaml`), solo steps
   `run:`. Se ignoran `uses:`, matrices y workflows reutilizables. Todo es
   lectura de archivos locales — el CLI nunca toca la red, y un repo local sin
   workflows simplemente no genera la sección.
5. **Arquitectura**: módulo nuevo `core/repo-facts.ts` separado de los packs
   (enfoque A). Los packs producen consejo por stack; los hechos son globales
   del repo. Los 15 packs no se tocan.
6. **Dependencia nueva**: `yaml` (parser puro sin dependencias transitivas)
   para los workflows. Parsear `run: |` multilínea con regex es frágil.

## Tipos nuevos (`core/types.ts`)

```typescript
interface CommandEntry {
  source: "npm" | "composer" | "make" | "mix" | "tox";
  name: string;     // "test", target de make, alias de mix, env de tox…
  command: string;  // "vitest run --coverage", o "make build" si el cuerpo no es legible
}

interface DirEntry {
  dir: string;      // "src/"
  note?: string;    // "código fuente" — solo si es inequívoco
}

interface RepoFacts {
  commands: CommandEntry[];
  structure: DirEntry[];
  ciCommands: { command: string; workflow: string }[]; // workflow = nombre de archivo
}
```

Cambios en señales:
- `RepoSignals.githubWorkflows?: { path: string; content: string }[]`
- `RepoSignals.toxIni?: string`
- `ComposerJsonManifest.scripts: Record<string, unknown>` (valores string o
  array en composer — se aplanan al extraer).

## Extractores (`core/repo-facts.ts`, funciones puras)

| Fuente | Entrada | Salida |
|---|---|---|
| npm | `packageJson.scripts` (ya capturado) | `npm run <name>` → cuerpo del script (`npm test`/`npm start` sin `run`) |
| composer | `composer.json` `"scripts"` (captura nueva) | `composer <name>` → cuerpo aplanado |
| make | `signals.makefile` (ya capturado) | targets de primer nivel → `make <target>` (no se interpreta el cuerpo) |
| mix | `signals.mixExs` (ya capturado) | aliases del keyword list `aliases` → `mix <alias>` |
| tox | `signals.toxIni` (captura nueva) | envs del `envlist` → `tox -e <env>` |

Reglas de extracción:
- **make**: regex de target `^[A-Za-z0-9_./-]+:` a inicio de línea; se excluyen
  targets especiales (empiezan por `.`), pattern rules (contienen `%`) y
  asignaciones de variables (`:=`, `?=`, `+=`). Ojo: `foo: bar` con
  dependencias sigue siendo target válido.
- **mix**: solo si el bloque `defp aliases` / `aliases:` matchea con un keyword
  list claro; ante ambigüedad, cero aliases (omitir antes que inventar).
- **Filtrado anti-ruido**: nombres bien conocidos (test, build, lint, fmt,
  format, check, dev, start, typecheck, ci, coverage…) entran siempre; el resto
  hasta un tope de 15 por fuente, añadiendo una nota "…y N más en <archivo>".

## CI (`extractCiCommands` en `repo-facts.ts`)

- Scanner captura el contenido crudo de `.github/workflows/*.yml|yaml`.
- Parseo con `yaml`; por cada job, por cada step con `run:`, se separan las
  líneas (bloques multilínea), se recortan, se descartan vacías y comentarios
  (`#…`), y se deduplican globalmente conservando el primer workflow de origen.
- Workflow que no parsea → se ignora ese archivo sin romper la ejecución.
- Tope de ~30 comandos, con nota de omisión si se supera.

## Estructura

- De `signals.files`: directorios de primer nivel (el walk ya excluye
  `node_modules`, `.git`, etc.).
- Tabla fija de anotaciones (match exacto, minúsculas): `src`, `lib`, `tests`,
  `test`, `spec`, `__tests__`, `docs`, `doc`, `examples`, `scripts`, `tools`,
  `migrations`, `benchmarks`, `.github`, `public`, `static`, `assets`,
  `config`. Sin match → sin nota.
- Tope de 20 entradas, orden alfabético.

## Render (`templates.ts`)

`renderClaudeMd` / `renderAgentsMd` / `renderCopilotInstructions` reciben
`facts: RepoFacts` además de `entries` y añaden, tras las secciones de stack:

```markdown
## Comandos del repo
- `npm test` → `vitest run --coverage` (package.json)
- `make docs` (Makefile)

## Estructura
- `src/` — código fuente
- `weirddir/`

## Lo que ejecuta CI (GitHub Actions)
- `npm ci` (ci.yml)
```

- Cada sección se omite entera si no tiene datos. Si las tres están vacías, el
  generado queda como hoy.
- Los prompts de review/refactor/testing no cambian.
- `cli.ts` computa los facts una vez (`buildRepoFacts(signals)`) y los pasa al
  render. Las secciones de hechos también se emiten en el fallback "no se
  detectó ningún stack" (un repo sin stack reconocible pero con Makefile y CI
  sigue recibiendo valor).

## Manejo de errores

Regla transversal: **omitir antes que inventar**. Cualquier entrada que no se
pueda interpretar con seguridad (YAML inválido, Makefile exótico, mix.exs
ambiguo) produce cero entradas de esa fuente, nunca una excepción ni un dato
especulativo.

## Testing

- TDD por extractor con manifiestos inline, incluyendo casos trampa: script
  npm vacío, Makefile con pattern rules y variables, workflow con `run: |`
  multilínea y con matrices (que se ignoran), composer scripts con valores
  array, mix.exs sin aliases.
- Tests de scanner para las capturas nuevas (workflows, tox.ini, composer
  scripts) — incluida tolerancia a BOM, que ya es regla del scanner.
- Tests de templates: secciones presentes con datos y omitidas sin ellos.
- Test e2e en `cli.test.ts` (repo temporal con package.json + workflow).
- Validación final estilo DEVNOTES: ejecutar el binario compilado contra 3-4
  repos reales clonados (express, flask, guzzle, uno con Makefile) antes de
  darlo por bueno.

## Fuera de alcance (explícito)

- GitLab CI, CircleCI y otros sistemas de CI.
- Interpretación profunda de workflows (matrices, `uses:`, composición).
- Anotación especulativa de directorios (heurísticas difusas o LLM).
- Extractores de comandos para Gradle/CMake/Cargo/etc. (sin scripts declarados).
- Cambios en el contrato `Pack` o en `docs/writing-a-pack.md`.
