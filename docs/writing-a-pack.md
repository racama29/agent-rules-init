# Cómo escribir un pack

Un pack implementa `Pack` en `packages/cli/src/core/types.ts`:

```typescript
interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet;
  promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[];
}
```

## Contrato

- `detect()` devuelve `null` cuando no existe una señal inequívoca del stack.
- Un campo usa confianza alta solo cuando un manifiesto o archivo conocido lo demuestra.
- Los valores de confianza baja no se presentan como hechos ni se preguntan al usuario.
- `rules()` produce texto bilingüe y separa defaults del stack de hechos locales.
- Los comandos proceden de `PackContext.facts`; un pack no inventa invocaciones.
- `promptTemplates()` solo aporta plantillas que puedan incorporar información local.

## Pasos

1. Crea `packages/cli/src/packs/<stack>.ts`.
2. Si falta una señal, añádela a `RepoSignals` y al escáner sin ejecutar código del proyecto.
3. Usa `detectNamedSignal()` y `detectedName()` de `pack-helpers.ts` para tablas sencillas.
4. Registra un loader dinámico y su criterio candidato en `packages/cli/src/packs/index.ts`.
5. Añade pruebas negativas, positivas y neutrales en `test/packs/`.
6. Añade casos positivos y negativos al corpus versionado.
7. Ejecuta `npm run check` y `npm run benchmark`.

## Ejemplo de detección

```typescript
const FRAMEWORKS = [
  ["axum", "axum"],
  ["rocket", "rocket"],
] as const;

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.cargoToml) return null;
  return {
    packId: "rust",
    language: "Rust",
    framework: detectNamedSignal(signals.cargoToml, FRAMEWORKS),
    testRunner: { value: "cargo test", confidence: "high" },
    packageManager: { value: "cargo", confidence: "high" },
  };
}
```

La presencia de un manifiesto permite detectar el lenguaje, pero no autoriza a afirmar
un framework que no aparezca en él. Un resultado breve y verificable es preferible a
rellenar campos desconocidos.

## Textos bilingües

Los patrones compartidos viven en `core/i18n.ts`. Los textos específicos permanecen en
una tabla local `Record<Lang, ...>`. No dupliques cuerpos de review, refactor o testing.

## Criterio de estabilidad

Un pack solo figura como estable cuando supera el corpus positivo y negativo, conserva
cero falsos positivos en ese corpus y todos sus comandos renderizados tienen
procedencia verificable.
