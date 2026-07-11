# Roadmap de calidad del contenido generado

## Contexto

`agent-rules-init` 0.4.0 ya dispone de una base técnica sólida:

- detección de stacks y gestores de paquetes;
- soporte para npm, pnpm, Yarn, Bun, uv, Maven Wrapper y Gradle Wrapper;
- reglas específicas para workspaces JavaScript/TypeScript;
- configuración persistente mediante `.agent-rules-init.yml`;
- modos `--dry-run`, `--check`, `--json` y `--non-interactive`;
- escritura atómica y generación idempotente;
- extracción de comandos, estructura y pasos de GitHub Actions.

Las pruebas con Express, Flask y Spring Petclinic confirman que los datos verificables se extraen correctamente. Sin embargo, las convenciones, descripciones de arquitectura y plantillas de prompts todavía contienen demasiado texto genérico.

El siguiente objetivo no debe ser añadir más stacks, sino conseguir que los stacks existentes produzcan instrucciones específicas, verificables y útiles para trabajar en cada repositorio.

## Diagnóstico actual

### Aspectos que ya funcionan bien

- Los comandos declarados se reproducen sin inventarlos.
- Se identifica el test runner y el gestor de paquetes.
- Se muestran los comandos reales de CI.
- La estructura de primer nivel refleja el repositorio.
- Los archivos se generan en rutas correctas y no sobrescriben contenido existente.
- Los workspaces pueden recibir su propio `AGENTS.generated.md`.

### Aspectos que necesitan mejora

1. Las reglas de arquitectura son demasiado universales:

   ```text
   Keep components/modules small and single-purpose.
   Respect the layered separation.
   Follow PEP 8.
   ```

2. Los prompts de review, refactor y testing son demasiado breves y no incluyen comandos, rutas ni convenciones reales.

3. Algunas recomendaciones no dependen suficientemente de la detección:

   - un proyecto JavaScript puede recibir referencias a errores de tipado;
   - un repositorio sin framework puede recibir referencias a “framework conventions”;
   - se recomienda el nombre del test runner aunque el comando canónico sea otro;
   - un repositorio con Maven y Gradle puede quedar descrito mediante una única ruta de build.

4. `CLAUDE.generated.md`, `AGENTS.generated.md` y las instrucciones de Copilot contienen prácticamente el mismo documento.

5. No se aprovechan todavía fuentes locales como `CONTRIBUTING.md`, configuraciones de lint, entrypoints o la distribución interna del código.

## Principios de desarrollo

Toda mejora de contenido debe respetar estos principios:

1. **No inventar.** Una afirmación específica debe tener una señal local que la respalde.
2. **Preferir evidencia a consejos genéricos.** Si no existe evidencia, es mejor omitir una regla.
3. **Conservar la procedencia.** Debe ser posible explicar de qué archivo surgió cada comando o convención.
4. **Usar comandos ejecutables.** Las instrucciones deben preferir `npm test`, `uv run ...`, `./mvnw verify`, etc., frente al nombre abstracto de una herramienta.
5. **Adaptar por alcance.** Las reglas globales pertenecen al documento raíz; las reglas de un paquete deben vivir en su `AGENTS.generated.md`.
6. **Mantener documentos breves.** Especificidad no significa producir documentación extensa o redundante.

## Objetivo de la siguiente versión

La siguiente versión debe transformar datos detectados en instrucciones específicas del repositorio.

Una salida de calidad debería responder con claridad:

- ¿qué comandos deben ejecutarse antes de terminar una tarea?;
- ¿dónde está el código afectado y dónde viven sus tests?;
- ¿qué arquitectura o separación existente debe respetarse?;
- ¿qué riesgos particulares debe revisar un agente?;
- ¿qué archivos declaran esas convenciones?;

## Línea 1: comandos canónicos

### Objetivo

Seleccionar un comando principal para test, lint, build, typecheck y formato, conservando comandos alternativos como información secundaria.

### Fuentes

Orden de preferencia recomendado:

1. scripts explícitos del manifiesto raíz o del workspace;
2. comandos utilizados por CI;
3. wrappers oficiales del repositorio;
4. aliases de herramientas como tox o Mix;
5. fallback conocido del lenguaje, solo si es inequívoco.

### Modelo sugerido

```typescript
interface CanonicalCommand {
  kind: "test" | "lint" | "build" | "format" | "typecheck";
  command: string;
  source: string;
  confidence: "high" | "low";
  scope: string;
}
```

### Criterios de aceptación

- Flask debe recomendar su flujo real basado en `uv` y tox, no únicamente `pytest`.
- Express debe usar `npm test` y `npm run lint`.
- Petclinic debe reflejar Maven Wrapper y, si procede, mencionar también el build Gradle utilizado por CI.
- Ningún comando debe requerir una instalación global cuando existe un wrapper o gestor local.

## Línea 2: hechos de arquitectura

### Objetivo

Extraer una descripción breve de la organización real del proyecto.

### Señales propuestas

- entrypoints declarados en manifests;
- directorios de código y tests;
- módulos o workspaces;
- configuración de routing, controllers, services o repositories;
- paquetes públicos y privados;
- migraciones, fixtures, templates y activos;
- archivos de configuración del framework;
- convenciones de colocación de tests.

### Modelo sugerido

```typescript
interface ArchitectureFact {
  statement: string;
  evidence: string[];
  scope: string;
  confidence: "high" | "low";
}
```

Solo deben renderizarse automáticamente los hechos con confianza alta.

## Línea 3: convenciones existentes

### Objetivo

Extraer reglas del propio repositorio antes de aplicar recomendaciones generales del pack.

### Fuentes candidatas

- `CONTRIBUTING.md`;
- secciones relevantes del README;
- `.editorconfig`;
- configuraciones de ESLint, Biome, Ruff, Black, Prettier o ClangFormat;
- `tsconfig.json`;
- configuración de pytest, tox, JUnit o test runners equivalentes;
- workflows de CI;
- scripts de package/build.

La extracción debe ser conservadora. No se debe copiar documentación completa: solo resumir reglas inequívocas y conservar la referencia al archivo fuente.

## Línea 4: reglas condicionales por pack

Cada pack debe construir sus reglas a partir de capacidades detectadas, no únicamente del lenguaje.

Ejemplos:

- mencionar TypeScript solamente cuando `usesTypeScript` sea verdadero;
- no mencionar convenciones de framework si `framework` es `none`;
- adaptar el consejo de tests al comando canónico;
- diferenciar aplicaciones que usan un framework de repositorios que implementan el propio framework;
- incluir reglas específicas de CommonJS o ESM solo cuando el formato sea inequívoco;
- evitar consejos sobre una arquitectura por capas si no existe evidencia de esas capas.

## Línea 5: prompts específicos

Los prompts deben incluir:

- alcance de la revisión;
- riesgos propios del stack o framework;
- rutas relevantes;
- comandos de validación;
- convenciones detectadas;
- formato de respuesta esperado.

### Ejemplo para Express

```md
# Code Review (Express)

Review the current diff against this repository's CommonJS conventions.

Run `npm test` for the Mocha suite and `npm run lint` for ESLint. Pay special
attention to middleware control flow, propagation through `next(err)`, response
lifecycle handling, backward compatibility and retained request state.

Tests live under `test/` and acceptance tests under `test/acceptance/`.
Report only concrete findings with file and line references.
```

### Criterios de aceptación

- Cada prompt debe incluir al menos un comando real cuando exista.
- No debe contener sentinelas ni expresiones vagas como “the project's framework”.
- No debe mencionar TypeScript en proyectos JavaScript.
- Debe contener al menos una ruta real del repositorio cuando pueda determinarse.
- Debe seguir siendo útil sin ejecutar el pulido opcional con IA.

## Línea 6: documentos por consumidor

Los tres documentos generales comparten hechos, pero no tienen por qué ser idénticos.

### `AGENTS.md`

- reglas operativas y de alcance;
- comandos obligatorios;
- arquitectura y restricciones;
- posibilidad de herencia mediante archivos anidados.

### `CLAUDE.md`

- contexto del proyecto;
- comandos y convenciones;
- orientación para tareas interactivas;
- referencias a comandos reutilizables.

### Copilot instructions

- convenciones concisas de implementación;
- patrones que deben respetarse al completar código;
- evitar contenido largo o propio de operaciones de terminal.

El renderizado debe reutilizar un modelo común de hechos, pero seleccionar y ordenar el contenido según el consumidor.

## Línea 7: evaluación de calidad

### Corpus inicial

- Express: JavaScript, CommonJS, npm, Mocha y ESLint.
- Flask: Python, uv, tox, pytest y paquete con layout `src/`.
- Spring Petclinic: Java, Spring, Maven Wrapper, Gradle y despliegue Kubernetes.
- Un monorepo pnpm con varios frameworks.
- Un repositorio mixto JS/Python.

### Qué medir

- precisión de stack, framework, test runner y gestor;
- comandos ejecutables;
- preguntas innecesarias;
- afirmaciones sin evidencia;
- reglas genéricas repetidas;
- estabilidad entre ejecuciones;
- diferencias esperadas entre consumidores;
- número de rutas y comandos reales presentes en los prompts.

### Tests recomendados

1. Tests unitarios de cada extractor.
2. Snapshots de los documentos completos del corpus.
3. Tests negativos para evitar frases incorrectas.
4. Ejecuciones `--dry-run --json` sobre fixtures versionados.
5. Pruebas periódicas sobre clones públicos mediante un script separado y no destructivo.

## Fases de implementación

### Fase 1: corregir incoherencias actuales

- Eliminar referencias TypeScript en JavaScript.
- Eliminar referencias a frameworks desconocidos.
- Usar el comando canónico de tests en reglas y prompts.
- Añadir tests negativos para estas regresiones.

### Fase 2: modelo de hechos enriquecido

- Introducir comandos canónicos.
- Introducir hechos de arquitectura con evidencia.
- Añadir entrypoints y estructura de tests.
- Exponer los hechos mediante `--json`.

### Fase 3: prompts enriquecidos

- Cambiar el contrato de `promptTemplates` para recibir hechos del repositorio.
- Actualizar primero JS/TS, Python y Java.
- Validar contra Express, Flask y Petclinic.
- Extender el patrón a los demás packs.

### Fase 4: consumidores diferenciados

- Crear renderizadores específicos para Claude, AGENTS y Copilot.
- Evitar duplicación mediante un modelo intermedio compartido.
- Mantener compatibilidad con idiomas inglés y español.

### Fase 5: corpus y control de calidad

- Versionar fixtures representativos.
- Añadir snapshots revisados manualmente.
- Crear una comprobación de calidad para CI.
- Documentar cómo actualizar los snapshots de forma consciente.

## Definición de terminado

La mejora de contenido estará terminada cuando:

- Express, Flask y Petclinic generen reglas claramente distinguibles entre sí;
- cada prompt contenga comandos y rutas reales;
- no aparezcan consejos incompatibles con las señales detectadas;
- toda afirmación específica pueda relacionarse con un archivo fuente;
- `--check` confirme estabilidad tras generar sin cambios en el repositorio;
- el resultado base sea suficientemente bueno sin depender del pulido con IA;
- todos los packs mantengan tests en español e inglés;
- la suite completa, build, typecheck y empaquetado npm continúen pasando.

## Prioridad recomendada

1. Corregir reglas condicionales incorrectas.
2. Introducir comandos canónicos.
3. Enriquecer prompts de JS/TS, Python y Java.
4. Extraer hechos de arquitectura y convenciones locales.
5. Diferenciar los documentos por consumidor.
6. Extender el modelo al resto de packs.
7. Añadir nuevos stacks solo después de alcanzar esta calidad.

La dirección del proyecto debe resumirse así:

> Generar pocas instrucciones, pero específicas, verificables y ejecutables para el repositorio analizado.
