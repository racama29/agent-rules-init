# Contribuir a agent-rules-init

## Desarrollo local

```bash
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

## Añadir un stack nuevo

Ver [`docs/writing-a-pack.md`](docs/writing-a-pack.md) — un pack nuevo es una carpeta en `packages/packs/` que implementa la interfaz `Pack` de `agent-rules-pack-types`, sin tocar `packages/cli/src/core/`.

## Pull requests

- Un PR por cambio lógico.
- Cada pack nuevo o modificado debe incluir tests unitarios (`detect`, `rules`, `promptTemplates`) con al menos un caso de confianza alta y uno de confianza baja.
- `npm run test --workspaces --if-present` debe pasar antes de abrir el PR.
