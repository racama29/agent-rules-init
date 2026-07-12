export type Lang = "es" | "en";

export function detectLang(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    return locale.toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

export function summarySentence(lang: Lang, language: string, framework?: string, parenthetical?: string): string {
  const paren = parenthetical ? ` (${parenthetical})` : "";
  if (lang === "es") return `Proyecto ${language}${framework ? ` con ${framework}` : ""}${paren}.`;
  return `${language} project${framework ? ` using ${framework}` : ""}${paren}.`;
}

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

export function refactorBody(lang: Lang, extra?: string): string {
  const base =
    lang === "es"
      ? "Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable."
      : "Propose refactors that reduce duplication and improve readability without changing observable behavior.";
  return extra ? `${base} ${extra}` : base;
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

export interface UiTexts {
  generatedHeader: string;
  sections: {
    commands: string;
    structure: string;
    ci: string;
    conventions: string;
    architecture: string;
    canonical: string;
  };
  andMore: (count: number, file?: string) => string;
  noStackFallback: string;
  question: (fieldLabel: string, language: string) => string;
  fieldLabels: { framework: string; testRunner: string; linter: string; packageManager: string };
  usage: string;
  automationUsage: string;
  unknownOption: (flag: string) => string;
  invalidLang: (value: string) => string;
  invalidAssistant: (value: string) => string;
  missingFlagValue: (flag: string) => string;
  assistantNotAvailable: (assistant: string) => string;
  noTtyWarning: string;
  skippedQuestion: (message: string) => string;
  enrichDetected: (assistant: string) => string;
  enrichConfirm: (assistant: string) => string;
  enrichWorking: (assistant: string) => string;
  enrichDone: string;
  enrichKept: string;
  enrichFailed: (assistant: string, error: string) => string;
  enrichNoAssistant: string;
  enrichEvidenceDropped: (paths: readonly string[]) => string;
  enrichRetrying: (assistant: string) => string;
  enrichPrompt: (filesJson: string, mustKeep: readonly string[], existingDocsJson?: string) => string;
  fileSkipped: (path: string) => string;
  outroWritten: string;
  outroNothing: string;
  unexpectedError: (message: string) => string;
  cancelled: string;
  dirNotes: Record<string, string>;
  testDirNote: string;
  entrypointNote: string;
}

export const UI: Record<Lang, UiTexts> = {
  es: {
    generatedHeader: "Generado por agent-rules-init a partir de lo detectado en este repo.",
    sections: {
      commands: "Comandos del repo",
      structure: "Estructura",
      ci: "Lo que ejecuta CI (GitHub Actions)",
      conventions: "Convenciones",
      architecture: "Arquitectura",
      canonical: "Comandos canónicos",
    },
    andMore: (count, file) => (file ? `…y ${count} más en ${file}` : `…y ${count} más`),
    noStackFallback: "No se detectó ningún stack conocido. Completa este archivo manualmente.",
    question: (fieldLabel, language) => `No se pudo determinar ${fieldLabel} para ${language}. ¿Cuál usáis?`,
    fieldLabels: {
      framework: "el framework",
      testRunner: "el test runner",
      linter: "el linter",
      packageManager: "el gestor de paquetes",
    },
    usage: `agent-rules-init — genera CLAUDE.md, AGENTS.md, copilot-instructions y prompts de review/refactor/testing a partir del stack detectado en tu repo.

Uso:
  npx agent-rules-init            escanea el directorio actual y genera los archivos *.generated.*
  npx agent-rules-init --enrich   además, usa tu claude/codex instalado para analizar el código y enriquecer el resultado
  npx agent-rules-init --lang es  fuerza el idioma del contenido (es|en); por defecto se detecta del sistema
  npx agent-rules-init --help     muestra esta ayuda
  npx agent-rules-init --version  muestra la versión

Los archivos se crean siempre con sufijo .generated y nunca sobrescriben nada existente:
revisa su contenido y quita el sufijo para activarlos.`,
    automationUsage: `Automatización:
  --dry-run         renderiza y muestra archivos sin escribir
  --check           termina con error si faltan archivos generados; nunca escribe
  --json            emite un único resultado JSON legible por máquinas
  --non-interactive omite preguntas y la oferta de enriquecimiento con IA
  --enrich          fuerza el enriquecimiento con IA sin preguntar (también sin TTY; combinable con --non-interactive)
  --assistant <id>  elige el asistente para enriquecer: claude o codex (por defecto, el primero instalado)
  --model <modelo>  modelo a usar, pasado tal cual al asistente (p. ej. haiku, gpt-5.5); por defecto, el del asistente`,
    unknownOption: (flag) => `Opción no reconocida: ${flag}`,
    invalidLang: (value) => `Valor de --lang no válido: "${value}" (usa "es" o "en").`,
    invalidAssistant: (value) => `Valor de --assistant no válido: "${value}" (usa "claude" o "codex").`,
    missingFlagValue: (flag) => `La opción ${flag} requiere un valor.`,
    assistantNotAvailable: (assistant) =>
      `Se pidió ${assistant} con --assistant pero no está instalado; se conserva la versión generada.`,
    noTtyWarning:
      "No se detectó una terminal interactiva (esto pasa a veces en Git Bash en Windows). " +
      "Continuando sin preguntas ni oferta de enriquecimiento con IA; se usarán los valores detectados.",
    skippedQuestion: (message) =>
      `No se detectó una terminal interactiva; se omite la pregunta "${message}" y se usa el valor detectado.`,
    enrichDetected: (assistant) =>
      `${assistant} detectado — puede analizar el código de este repo y sustituir las secciones genéricas por reglas específicas verificadas.`,
    enrichConfirm: (assistant) =>
      `¿Quieres que ${assistant} analice el repositorio y enriquezca los archivos generados? Usará tu instalación de ${assistant} y puede tardar unos minutos.`,
    enrichWorking: (assistant) => `${assistant} está analizando el repositorio y enriqueciendo los archivos…`,
    enrichDone: "Archivos enriquecidos con lo observado en el repositorio.",
    enrichKept: "No se aplicó el enriquecimiento; se conserva la versión generada.",
    enrichFailed: (assistant, error) =>
      `No se pudo enriquecer el contenido con ${assistant}, se mantiene la versión generada: ${error}`,
    enrichNoAssistant:
      "Se pidió --enrich pero no se encontró ningún asistente (claude o codex) instalado; se conserva la versión generada.",
    enrichEvidenceDropped: (paths) =>
      `Se descartaron afirmaciones del enriquecimiento porque su evidencia citada no existe en el repo: ${paths.join(", ")}`,
    enrichRetrying: (assistant) => `La respuesta de ${assistant} no pasó la validación; se reintenta una vez…`,
    enrichPrompt: (filesJson, mustKeep, existingDocsJson) =>
      "Estás ejecutándote en la raíz de un repositorio. Los siguientes archivos de instrucciones para agentes de IA " +
      "se generaron solo a partir de manifiestos, CI y configuración, por lo que algunas secciones (convenciones, arquitectura, prompts) son genéricas.\n" +
      "Primero investiga el repositorio real con tus herramientas de lectura: configuración de estilo (linter, formatter, pre-commit), " +
      "CONTRIBUTING/README, y el código fuente y los tests suficientes para entender sus convenciones y arquitectura reales.\n" +
      "Después reescribe cada archivo sustituyendo o ampliando los consejos genéricos con reglas específicas y comprobables de este repositorio, " +
      "citando la evidencia de cada afirmación nueva con el formato (evidencia: `ruta/del/archivo`); las rutas citadas se verificarán contra el repo. " +
      "No inventes comandos, rutas ni APIs; no afirmes nada que no hayas comprobado. " +
      "Conserva el idioma, el formato Markdown y las rutas de cada archivo.\n" +
      (mustKeep.length > 0
        ? `Conserva literalmente estos comandos, sin modificarlos: ${mustKeep.map((c) => `\`${c}\``).join(", ")}.\n`
        : "") +
      (existingDocsJson
        ? "El repositorio ya contiene estos documentos de instrucciones mantenidos a mano; reflejan la intención del equipo. " +
          "Integra sus reglas en los archivos generados correspondientes sin contradecirlas ni perderlas.\n" +
          `Documentos existentes (JSON):\n${existingDocsJson}\n`
        : "") +
      "Devuelve únicamente un array JSON válido con exactamente los mismos objetos path/content y en el mismo orden, sin bloque de código ni comentarios. " +
      `Entrada JSON:\n${filesJson}`,
    fileSkipped: (path) => `${path}: ya existía, se conserva sin cambios.`,
    outroWritten:
      "Revisa los archivos *.generated.* y, cuando estés conforme, quita el sufijo " +
      '".generated" (ej. "CLAUDE.generated.md" → "CLAUDE.md") para activarlos — ' +
      "tu asistente de IA solo lee el nombre final, no el generado.",
    outroNothing: "No se generó ningún archivo nuevo.",
    unexpectedError: (message) => `Fallo inesperado: ${message}`,
    cancelled: "Operación cancelada.",
    dirNotes: {
      src: "código fuente",
      lib: "código fuente",
      tests: "tests",
      test: "tests",
      spec: "tests",
      __tests__: "tests",
      docs: "documentación",
      doc: "documentación",
      examples: "ejemplos",
      scripts: "scripts auxiliares",
      tools: "herramientas auxiliares",
      migrations: "migraciones de base de datos",
      benchmarks: "benchmarks",
      ".github": "workflows y configuración de GitHub",
      public: "activos públicos",
      static: "activos estáticos",
      assets: "activos",
      config: "configuración",
    },
    testDirNote: "tests",
    entrypointNote: "punto de entrada",
  },
  en: {
    generatedHeader: "Generated by agent-rules-init from what was detected in this repo.",
    sections: {
      commands: "Repo commands",
      structure: "Structure",
      ci: "What CI runs (GitHub Actions)",
      conventions: "Conventions",
      architecture: "Architecture",
      canonical: "Canonical commands",
    },
    andMore: (count, file) => (file ? `…and ${count} more in ${file}` : `…and ${count} more`),
    noStackFallback: "No known stack was detected. Fill in this file manually.",
    question: (fieldLabel, language) => `Couldn't determine ${fieldLabel} for ${language}. Which one do you use?`,
    fieldLabels: {
      framework: "the framework",
      testRunner: "the test runner",
      linter: "the linter",
      packageManager: "the package manager",
    },
    usage: `agent-rules-init — generates CLAUDE.md, AGENTS.md, copilot-instructions and review/refactor/testing prompts from the stack detected in your repo.

Usage:
  npx agent-rules-init            scan the current directory and generate the *.generated.* files
  npx agent-rules-init --enrich   additionally, use your installed claude/codex to analyze the code and enrich the output
  npx agent-rules-init --lang en  force the content language (es|en); defaults to the system locale
  npx agent-rules-init --help     show this help
  npx agent-rules-init --version  show the version

Files are always created with the .generated suffix and never overwrite anything:
review their content and drop the suffix to activate them.`,
    automationUsage: `Automation:
  --dry-run         render and print files without writing
  --check           exit non-zero if generated files are missing; never write
  --json            emit a single machine-readable JSON result
  --non-interactive skip questions and the AI-enrichment offer
  --enrich          force AI enrichment without asking (works without a TTY; composable with --non-interactive)
  --assistant <id>  pick the enrichment assistant: claude or codex (defaults to the first one installed)
  --model <model>   model to use, forwarded verbatim to the assistant (e.g. haiku, gpt-5.5); defaults to the assistant's own`,
    unknownOption: (flag) => `Unknown option: ${flag}`,
    invalidLang: (value) => `Invalid --lang value: "${value}" (use "es" or "en").`,
    invalidAssistant: (value) => `Invalid --assistant value: "${value}" (use "claude" or "codex").`,
    missingFlagValue: (flag) => `The ${flag} option requires a value.`,
    assistantNotAvailable: (assistant) =>
      `${assistant} was requested with --assistant but is not installed; keeping the generated version.`,
    noTtyWarning:
      "No interactive terminal detected (this sometimes happens in Git Bash on Windows). " +
      "Continuing without questions or the AI-enrichment offer; detected values will be used.",
    skippedQuestion: (message) =>
      `No interactive terminal detected; skipping the question "${message}" and using the detected value.`,
    enrichDetected: (assistant) =>
      `${assistant} detected — it can analyze this repo's code and replace the generic sections with verified, repo-specific rules.`,
    enrichConfirm: (assistant) =>
      `Do you want ${assistant} to analyze the repository and enrich the generated files? It will use your ${assistant} installation and may take a few minutes.`,
    enrichWorking: (assistant) => `${assistant} is analyzing the repository and enriching the files…`,
    enrichDone: "Files enriched with what was observed in the repository.",
    enrichKept: "Enrichment was not applied; keeping the generated version.",
    enrichFailed: (assistant, error) =>
      `Couldn't enrich the content with ${assistant}, keeping the generated version: ${error}`,
    enrichNoAssistant:
      "--enrich was requested but no installed assistant (claude or codex) was found; keeping the generated version.",
    enrichEvidenceDropped: (paths) =>
      `Dropped enrichment claims because their cited evidence does not exist in the repo: ${paths.join(", ")}`,
    enrichRetrying: (assistant) => `${assistant}'s response failed validation; retrying once…`,
    enrichPrompt: (filesJson, mustKeep, existingDocsJson) =>
      "You are running at the root of a repository. The following instruction files for AI agents were generated " +
      "from manifests, CI and configuration only, so some sections (conventions, architecture, prompts) are generic.\n" +
      "First investigate the actual repository with your read tools: style configuration (linter, formatter, pre-commit), " +
      "CONTRIBUTING/README, and enough of the source code and tests to understand its real conventions and architecture.\n" +
      "Then rewrite each file, replacing or extending the generic advice with specific, verifiable rules from this repository, " +
      "citing the evidence for every new claim in the form (evidence: `path/to/file`); cited paths will be checked against the repo. " +
      "Do not invent commands, paths or APIs; do not state anything you have not verified. " +
      "Keep each file's language, Markdown format and path.\n" +
      (mustKeep.length > 0
        ? `Keep these commands verbatim, unmodified: ${mustKeep.map((c) => `\`${c}\``).join(", ")}.\n`
        : "") +
      (existingDocsJson
        ? "The repository already contains these hand-maintained instruction documents; they reflect the team's intent. " +
          "Integrate their rules into the corresponding generated files without contradicting or losing them.\n" +
          `Existing documents (JSON):\n${existingDocsJson}\n`
        : "") +
      "Return only a valid JSON array with exactly the same path/content objects in the same order, without a code fence or commentary. " +
      `Input JSON:\n${filesJson}`,
    fileSkipped: (path) => `${path}: already existed, left unchanged.`,
    outroWritten:
      "Review the *.generated.* files and, once you are happy with them, drop the " +
      '".generated" suffix (e.g. "CLAUDE.generated.md" → "CLAUDE.md") to activate them — ' +
      "your AI assistant only reads the final name, not the generated one.",
    outroNothing: "No new files were generated.",
    unexpectedError: (message) => `Unexpected failure: ${message}`,
    cancelled: "Operation cancelled.",
    dirNotes: {
      src: "source code",
      lib: "source code",
      tests: "tests",
      test: "tests",
      spec: "tests",
      __tests__: "tests",
      docs: "documentation",
      doc: "documentation",
      examples: "examples",
      scripts: "helper scripts",
      tools: "helper tooling",
      migrations: "database migrations",
      benchmarks: "benchmarks",
      ".github": "GitHub workflows and configuration",
      public: "public assets",
      static: "static assets",
      assets: "assets",
      config: "configuration",
    },
    testDirNote: "tests",
    entrypointNote: "entry point",
  },
};
