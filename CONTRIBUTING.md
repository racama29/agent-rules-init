# Contribuir a agent-rules-init

## Desarrollo local

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Añadir un stack nuevo

Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) — un pack nuevo es un archivo en `packages/cli/src/packs/` que implementa la interfaz `Pack` de `packages/cli/src/core/types.ts`.

## Pull requests

- Un PR por cambio lógico.
- Cada pack nuevo o modificado debe incluir tests unitarios (`detect`, `rules`, `promptTemplates`) con al menos un caso de confianza alta y uno de confianza baja.
- `npm run test --workspaces --if-present` debe pasar antes de abrir el PR.

## Releases

La publicación se ejecuta automáticamente al subir un tag `vX.Y.Z`. Antes de crear el tag:

1. Actualiza `packages/cli/package.json` y `package-lock.json` con la misma versión.
2. Mueve las notas relevantes de `Unreleased` a una sección fechada en `CHANGELOG.md`.
3. Confirma que la CI de la rama principal está verde.
4. Crea y sube el tag. El workflow vuelve a ejecutar lint, build y tests, verifica que el tag coincide con la versión y publica con provenance.

El repositorio de GitHub debe tener configurado el secreto `NPM_TOKEN` con permisos de publicación para `agent-rules-init`.

El smoke test real de enriquecimiento es manual porque consume la sesión del asistente y envía únicamente el fixture sintético `node-plain`:

```bash
npm run test:enrich --workspace packages/cli -- claude haiku
npm run test:enrich --workspace packages/cli -- codex
```

La prueba exige contenido realmente enriquecido, cero fallbacks y ninguna modificación del fixture.
