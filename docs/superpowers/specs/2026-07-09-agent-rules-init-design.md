# agent-rules-init — Diseño

## Problema

Los desarrolladores usan asistentes de IA (Claude Code, Codex, Copilot, Cursor) como chat genérico porque no saben configurar instrucciones, reglas, agentes ni contexto de repo para ellos. Cada asistente tiene su propio formato de configuración (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, prompt files, slash commands), y casi ninguna herramienta ayuda a poblarlos bien.

## Objetivo del MVP

Un CLI (`npx agent-rules-init`) que genera esos ficheros de configuración **derivándolos del repo real** (stack, framework, testing, convenciones detectadas) en vez de partir de un cuestionario ciego, con un cuestionario como fallback para lo que no se puede inferir. Proyecto 100% open source, publicado en GitHub y npm, sin packs de pago.

## Por qué inferencia + preguntas, y no solo plantillas

Un generador basado únicamente en un cuestionario con find-and-replace es fácilmente clonable y percibido como plantilla genérica. Leer el repo real (manifiestos, configs, estructura) y derivar las reglas de lo que el código *ya hace* es el diferencial defendible frente a repos de plantillas existentes en GitHub.

## Arquitectura

```
agent-rules-init/
├── packages/
│   ├── cli/                     # paquete publicado en npm como "agent-rules-init"
│   │   ├── cli.ts               # entry point, orquesta el flujo
│   │   └── core/
│   │       ├── scanner.ts        # recorre el repo, recolecta "señales" crudas (agnóstico de stack)
│   │       ├── prompt-engine.ts  # preguntas interactivas para lo que no se pudo inferir
│   │       ├── llm-bridge.ts     # shell-out opcional a `claude -p` / `codex exec`
│   │       └── writer.ts         # escribe los ficheros de salida (nunca sobrescribe)
│   └── packs/
│       ├── pack-js-ts/
│       ├── pack-python/
│       ├── pack-java/
│       └── pack-php/
├── fixtures/                     # repos de ejemplo para tests
├── docs/
│   └── writing-a-pack.md         # guía de contribución de packs nuevos
├── .github/workflows/ci.yml
├── CONTRIBUTING.md
├── LICENSE                       # MIT
└── README.md
```

Tech stack del CLI: **Node.js + TypeScript**, distribuido vía `npx` (sin instalación previa).

### Flujo de ejecución

1. `scanner` recorre el repo una vez y produce `RepoSignals`: manifiestos encontrados (`package.json`, `pyproject.toml`/`requirements.txt`, `pom.xml`/`build.gradle`, `composer.json`), lockfiles, ficheros de config (linter, testing), estructura de carpetas. Agnóstico de stack.
2. El CLI itera sobre los `packs` registrados. Cada uno decide si aplica (`detect(signals)`). Puede haber más de un pack activo a la vez (ej. monorepo con frontend JS + backend Python).
3. Todo lo que ningún pack pudo inferir con confianza alta dispara preguntas puntuales vía `prompt-engine` (ej. estilo de commits).
4. Con señales + respuestas se compone el contenido base — determinista, sin LLM.
5. Si detecta `claude` o `codex` CLI instalados y autenticados, ofrece (pregunta explícita, nunca automático) un paso opcional de `llm-bridge` para pulir/expandir la redacción sobre esa base, reutilizando la suscripción ya autenticada del usuario (sin gestionar credenciales propias ni coste de API para el proyecto).
6. `writer` genera todo en ficheros nuevos con sufijo `.generated.` (`CLAUDE.generated.md`, `AGENTS.generated.md`, etc.), sin tocar nunca ficheros existentes del usuario.

### Contrato de packs

```typescript
interface Pack {
  id: string;                    // "js-ts", "python", "java", "php"...
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;                    // convenciones, arquitectura
  promptTemplates(detection: DetectionResult): PromptTemplate[]; // review/refactor/testing
}
```

- `DetectionResult` incluye un **nivel de confianza por campo** (ej. `{ framework: "express", testRunner: "jest", packageManager: "pnpm" }`). Los campos de confianza baja se convierten en preguntas al usuario en vez de asumirse.
- Detección **superficial y homogénea en todos los stacks** para el MVP: framework, gestor de dependencias, test runner y linter vía ficheros de manifiesto — mismo nivel de profundidad en JS/TS, Python, Java y PHP.
- Cada pack vive en su propia carpeta e implementa el mismo contrato — añadir un stack nuevo (ej. Ruby, Go) es una PR que implementa `Pack`, sin tocar `core/`.
- Todos los packs se publican juntos en el mismo paquete npm; no hay distinción premium/gratis.

### Outputs del MVP

- `CLAUDE.generated.md`
- `AGENTS.generated.md`
- `.github/copilot-instructions.generated.md`
- Prompts de review/refactor/testing, generados en dos formatos por convención de cada asistente:
  - `.claude/commands/{review,refactor,testing}.generated.md` (slash commands de Claude Code)
  - `.github/prompts/{review,refactor,testing}.generated.prompt.md` (prompt files de VS Code)

Reglas de arquitectura y convenciones del proyecto quedan integradas dentro de estos ficheros base, no como ficheros separados en el MVP.

### Manejo de conflictos con ficheros existentes

El CLI **nunca sobrescribe** ficheros existentes. Siempre genera en ficheros nuevos con sufijo `.generated.`; el usuario revisa y renombra/fusiona manualmente. Prioriza cero riesgo de pérdida de configuración ya afinada a mano sobre la comodidad de un merge automático.

### Manejo de errores y casos límite

- Repo vacío o sin manifiestos detectables → ningún pack aplica → cuestionario completo como fallback, sin romper el flujo.
- `claude`/`codex` instalados pero no autenticados → `llm-bridge` detecta el fallo al invocar, avisa, y continúa solo con las plantillas deterministas.
- Dos packs detectan el mismo campo con valores distintos (monorepos atípicos) → se listan ambos y se pregunta al usuario, en vez de que uno gane silenciosamente.
- Fallo de escritura en un fichero concreto (ej. no se puede crear `.github/`) → se informa por fichero y se continúa generando el resto; nunca se aborta el batch completo.

Regla general: degradar con aviso y continuar, nunca abortar todo el proceso por un fallo parcial.

## Estrategia de testing

- **`scanner` y cada `pack`**: tests unitarios con fixtures de repos de ejemplo (`fixtures/node-react-vitest/`, `fixtures/python-fastapi/`, `fixtures/monorepo-js-python/`), verificando `DetectionResult` y su nivel de confianza esperados.
- **`writer`**: verifica que un fichero existente nunca se sobrescribe y que siempre se genera con sufijo `.generated.`.
- **`llm-bridge`**: se testea con el CLI de Claude/Codex mockeado (sin llamadas reales a API en CI); verifica parseo de output y fallback si no está disponible.
- **End-to-end**: ejecución completa del CLI sobre 2-3 fixtures reales con snapshot testing del output generado, para detectar regresiones al añadir packs nuevos.

## Publicación

- Publicado en npm como `agent-rules-init`, invocable con `npx agent-rules-init` sin instalación previa.
- Repo en GitHub con licencia MIT, `CONTRIBUTING.md` y `docs/writing-a-pack.md` para que la comunidad añada stacks nuevos vía PR.
- CI en GitHub Actions: lint + tests + build en cada PR; publicación a npm automática en tags (`v*`).
- README centrado en el problema (asistentes de IA usados como chat genérico por falta de configuración), con ejemplo del flujo de uso y tabla de stacks soportados con su estado.

## Fuera de alcance del MVP

- Packs de pago / monetización dentro del propio código — el contrato de `Pack` no impide añadir esto más adelante, pero no se diseña ahora.
- Soporte de otros asistentes vía `llm-bridge` más allá de Claude Code y Codex CLI (ej. Copilot CLI) — queda para iteración futura.
- Detección profunda por stack (parseo de reglas de linter, patrones de arquitectura) — el MVP usa detección superficial homogénea en todos los stacks.
- Merge automático con ficheros de configuración existentes — el MVP solo genera ficheros nuevos.
