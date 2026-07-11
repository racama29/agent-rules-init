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

export function runTestsConvention(lang: Lang, cmd: string): string {
  return lang === "es"
    ? `Ejecuta los tests con ${cmd} antes de terminar una tarea.`
    : `Run the tests with ${cmd} before finishing a task.`;
}

export function reviewBody(lang: Lang, focus: string, framework: string): string {
  // Con focus vacío la frase colapsa a "bugs y desviaciones" sin coma colgante.
  const focusPart = focus ? `, ${focus}` : "";
  return lang === "es"
    ? `Revisa el diff actual buscando bugs${focusPart} y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`
    : `Review the current diff looking for bugs${focusPart} and deviations from ${framework} conventions. Point out only concrete issues with file and line.`;
}

export function refactorBody(lang: Lang, extra?: string): string {
  const base =
    lang === "es"
      ? "Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable."
      : "Propose refactors that reduce duplication and improve readability without changing observable behavior.";
  return extra ? `${base} ${extra}` : base;
}

export function testingBody(lang: Lang, runner: string): string {
  return lang === "es"
    ? `Escribe tests con ${runner} para el código señalado. Cubre el camino feliz y al menos un caso límite.`
    : `Write tests with ${runner} for the highlighted code. Cover the happy path and at least one edge case.`;
}

export function unknownRunnerLabel(lang: Lang): string {
  return lang === "es" ? "el test runner del proyecto" : "the project's test runner";
}

export function unknownFrameworkLabel(lang: Lang): string {
  return lang === "es" ? "el framework del proyecto" : "the project's framework";
}

export interface UiTexts {
  generatedHeader: string;
  sections: { commands: string; structure: string; ci: string; conventions: string; architecture: string };
  andMore: (count: number, file?: string) => string;
  noStackFallback: string;
  question: (fieldLabel: string, language: string) => string;
  fieldLabels: { framework: string; testRunner: string; linter: string; packageManager: string };
  usage: string;
  unknownOption: (flag: string) => string;
  invalidLang: (value: string) => string;
  noTtyWarning: string;
  skippedQuestion: (message: string) => string;
  polishDetected: (assistant: string) => string;
  polishConfirm: (assistant: string) => string;
  polishFailed: (assistant: string, error: string) => string;
  polishPrompt: (content: string) => string;
  fileSkipped: (path: string) => string;
  outroWritten: string;
  outroNothing: string;
  unexpectedError: (message: string) => string;
  cancelled: string;
  dirNotes: Record<string, string>;
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
  npx agent-rules-init --lang es  fuerza el idioma del contenido (es|en); por defecto se detecta del sistema
  npx agent-rules-init --help     muestra esta ayuda
  npx agent-rules-init --version  muestra la versión

Los archivos se crean siempre con sufijo .generated y nunca sobrescriben nada existente:
revisa su contenido y quita el sufijo para activarlos.`,
    unknownOption: (flag) => `Opción no reconocida: ${flag}`,
    invalidLang: (value) => `Valor de --lang no válido: "${value}" (usa "es" o "en").`,
    noTtyWarning:
      "No se detectó una terminal interactiva (esto pasa a veces en Git Bash en Windows). " +
      "Continuando sin preguntas ni oferta de pulido con IA; se usarán los valores detectados.",
    skippedQuestion: (message) =>
      `No se detectó una terminal interactiva; se omite la pregunta "${message}" y se usa el valor detectado.`,
    polishDetected: (assistant) => `${assistant} detectado — puede ayudar a pulir la redacción final.`,
    polishConfirm: (assistant) => `Se detectó ${assistant}. ¿Quieres que pula la redacción final?`,
    polishFailed: (assistant, error) =>
      `No se pudo pulir el contenido con ${assistant}, se mantiene el original: ${error}`,
    polishPrompt: (content) =>
      `Pule la redacción del siguiente documento de instrucciones para un agente de IA, sin cambiar su significado ni estructura. Devuelve únicamente el documento pulido, sin comentarios ni explicaciones adicionales:\n\n${content}`,
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
  },
  en: {
    generatedHeader: "Generated by agent-rules-init from what was detected in this repo.",
    sections: {
      commands: "Repo commands",
      structure: "Structure",
      ci: "What CI runs (GitHub Actions)",
      conventions: "Conventions",
      architecture: "Architecture",
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
  npx agent-rules-init --lang en  force the content language (es|en); defaults to the system locale
  npx agent-rules-init --help     show this help
  npx agent-rules-init --version  show the version

Files are always created with the .generated suffix and never overwrite anything:
review their content and drop the suffix to activate them.`,
    unknownOption: (flag) => `Unknown option: ${flag}`,
    invalidLang: (value) => `Invalid --lang value: "${value}" (use "es" or "en").`,
    noTtyWarning:
      "No interactive terminal detected (this sometimes happens in Git Bash on Windows). " +
      "Continuing without questions or the AI-polish offer; detected values will be used.",
    skippedQuestion: (message) =>
      `No interactive terminal detected; skipping the question "${message}" and using the detected value.`,
    polishDetected: (assistant) => `${assistant} detected — it can help polish the final wording.`,
    polishConfirm: (assistant) => `${assistant} was detected. Do you want it to polish the final wording?`,
    polishFailed: (assistant, error) => `Couldn't polish the content with ${assistant}, keeping the original: ${error}`,
    polishPrompt: (content) =>
      `Polish the wording of the following instructions document for an AI agent, without changing its meaning or structure. Return only the polished document, with no extra comments or explanations:\n\n${content}`,
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
  },
};
