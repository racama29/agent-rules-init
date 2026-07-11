# Cómo escribir un pack

Un pack implementa la interfaz `Pack` definida en `packages/cli/src/core/types.ts`:

```typescript
interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult, lang: Lang): RuleSet;
  promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[];
}
```

Todos los packs viven dentro del único paquete `agent-rules-init` — no hace falta crear ni publicar ningún paquete npm nuevo para añadir un stack.

## Pasos

1. Crea `packages/cli/src/packs/<stack>.ts` — usa `packages/cli/src/packs/python.ts` o `ruby.ts` como referencia. Si el stack necesita leer un manifiesto que `RepoSignals` (en `packages/cli/src/core/types.ts`) todavía no expone, añade el campo ahí y léelo en `packages/cli/src/core/scanner.ts` (sigue el patrón de `gemfile`/`goMod`/`cargoToml`/`csproj`).
2. `detect()` debe devolver `null` si no encuentra ninguna señal de que el stack aplica (ej. ningún manifiesto reconocible). Si aplica, marca cada campo (`framework`, `testRunner`, `linter`, `packageManager`) con `confidence: "high"` solo cuando la señal sea inequívoca (ej. una dependencia conocida presente, o una herramienta que el lenguaje siempre usa como Go con `go test`); si no, usa `confidence: "low"` — esos campos se preguntarán al usuario.
3. `rules()` traduce la detección en un `RuleSet` (resumen + convenciones + notas de arquitectura) **en el idioma recibido** (`lang: "es" | "en"`), orientado a un agente de IA que va a trabajar en ese repo.
4. `promptTemplates()` debe devolver exactamente tres plantillas con `id: "review" | "refactor" | "testing"`, también en el idioma recibido.
5. Añade tests en `packages/cli/test/packs/<stack>.test.ts` cubriendo: sin señales (`null`), detección de alta confianza, detección de baja confianza, y que las tres plantillas de prompt se generan. El test compartido `test/packs/i18n-en.test.ts` verificará automáticamente que tu pack responde en ambos idiomas (regístralo en su lista).
6. Registra el pack en `ALL_PACKS` dentro de `packages/cli/src/cli.ts`.

## Textos bilingües: patrones compartidos + tabla local

Los textos que se repiten entre packs (el resumen, la convención de "ejecuta
los tests con X", los cuerpos de review/refactor/testing) viven UNA sola vez
en `packages/cli/src/core/i18n.ts` como funciones bilingües — **úsalas
siempre, no dupliques esas plantillas en tu pack**:

```typescript
import {
  refactorBody, reviewBody, runTestsConvention, summarySentence,
  testingBody, unknownFrameworkLabel, unknownRunnerLabel, type Lang,
} from "../core/i18n.js";
```

Los fragmentos específicos de tu stack (guía de estilo, notas de
arquitectura, la cláusula de foco del review) van en una tabla local con
ambos idiomas:

```typescript
const TEXTS: Record<Lang, { style: string; arch: string[]; reviewFocus: string }> = {
  es: { style: "Sigue PEP 8; …", arch: ["…"], reviewFocus: "manejo de excepciones incorrecto" },
  en: { style: "Follow PEP 8; …", arch: ["…"], reviewFocus: "incorrect exception handling" },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return {
    summary: summarySentence(lang, "Python", framework),
    conventions: [t.style, runTestsConvention(lang, runner ?? unknownRunnerLabel(lang))],
    architectureNotes: t.arch,
  };
}
```

Los títulos de las plantillas ("Code Review (Python)") son neutros y no se
traducen. Ojo con los centinelas: `framework === "none"` y
`testRunner === "unknown"` nunca deben aparecer en el texto generado — usa
`unknownFrameworkLabel(lang)` / `unknownRunnerLabel(lang)` como fallback.

## Ejemplo de detección "siempre segura"

Algunos lenguajes tienen una única herramienta oficial de tests/paquetes (Go, Rust) — en esos casos no hace falta buscar nada, se marca directamente con `confidence: "high"`:

```typescript
testRunner: { value: "cargo test", confidence: "high" },
packageManager: { value: "cargo", confidence: "high" },
```
