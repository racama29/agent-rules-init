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

Todos los packs viven dentro del único paquete `agent-rules-init` — no hace falta crear ni publicar ningún paquete npm nuevo para añadir un stack.

## Pasos

1. Crea `packages/cli/src/packs/<stack>.ts` — usa `packages/cli/src/packs/python.ts` o `ruby.ts` como referencia. Si el stack necesita leer un manifiesto que `RepoSignals` (en `packages/cli/src/core/types.ts`) todavía no expone, añade el campo ahí y léelo en `packages/cli/src/core/scanner.ts` (sigue el patrón de `gemfile`/`goMod`/`cargoToml`/`csproj`).
2. `detect()` debe devolver `null` si no encuentra ninguna señal de que el stack aplica (ej. ningún manifiesto reconocible). Si aplica, marca cada campo (`framework`, `testRunner`, `linter`, `packageManager`) con `confidence: "high"` solo cuando la señal sea inequívoca (ej. una dependencia conocida presente, o una herramienta que el lenguaje siempre usa como Go con `go test`); si no, usa `confidence: "low"` — esos campos se preguntarán al usuario.
3. `rules()` traduce la detección en un `RuleSet` (resumen + convenciones + notas de arquitectura), en español, orientado a un agente de IA que va a trabajar en ese repo.
4. `promptTemplates()` debe devolver exactamente tres plantillas con `id: "review" | "refactor" | "testing"`.
5. Añade tests en `packages/cli/test/packs/<stack>.test.ts` cubriendo: sin señales (`null`), detección de alta confianza, detección de baja confianza, y que las tres plantillas de prompt se generan.
6. Registra el pack en `ALL_PACKS` dentro de `packages/cli/src/cli.ts`.

## Ejemplo de detección "siempre segura"

Algunos lenguajes tienen una única herramienta oficial de tests/paquetes (Go, Rust) — en esos casos no hace falta buscar nada, se marca directamente con `confidence: "high"`:

```typescript
testRunner: { value: "cargo test", confidence: "high" },
packageManager: { value: "cargo", confidence: "high" },
```
