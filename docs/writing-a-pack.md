# Cómo escribir un pack

Un pack implementa la interfaz `Pack` definida en el paquete compartido `agent-rules-pack-types` (`packages/pack-types/src/index.ts`):

```typescript
interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;
  promptTemplates(detection: DetectionResult): PromptTemplate[];
}
```

## Pasos

1. Crea `packages/packs/pack-<stack>/` con `package.json`, `tsconfig.json` y `src/index.ts` — usa `packages/packs/pack-python` como referencia de estructura. Añade `"agent-rules-pack-types": "0.1.0"` como dependencia; **no** dependas del paquete `agent-rules-init` (el CLI depende de los packs, no al revés).
2. `detect()` debe devolver `null` si no encuentra ninguna señal de que el stack aplica (ej. ningún manifiesto reconocible). Si aplica, marca cada campo (`framework`, `testRunner`, `linter`, `packageManager`) con `confidence: "high"` solo cuando la señal sea inequívoca (ej. una dependencia conocida presente); si no, usa `confidence: "low"` — esos campos se preguntarán al usuario.
3. `rules()` traduce la detección en un `RuleSet` (resumen + convenciones + notas de arquitectura), en español, orientado a un agente de IA que va a trabajar en ese repo.
4. `promptTemplates()` debe devolver exactamente tres plantillas con `id: "review" | "refactor" | "testing"`.
5. Añade tests en `test/index.test.ts` cubriendo: sin señales (`null`), detección de alta confianza, detección de baja confianza, y que las tres plantillas de prompt se generan.
6. Añade el pack a `packages/root package.json` `workspaces` (ya cubierto por el glob `packages/packs/*`), regístralo en `ALL_PACKS` dentro de `packages/cli/src/cli.ts`, y añádelo como dependencia en `packages/cli/package.json`.
