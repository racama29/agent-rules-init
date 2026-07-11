import type {
  CanonicalCommand,
  DetectionField,
  DetectionResult,
  Pack,
  PackContext,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";
import {
  refactorBody,
  reviewBody,
  runTestsConvention,
  summarySentence,
  testingBody,
  type Lang,
} from "../core/i18n.js";

const FRAMEWORKS: [string, string][] = [
  ["fastapi", "fastapi"],
  ["django", "django"],
  ["flask", "flask"],
];

const TEST_RUNNERS: [string, string][] = [
  ["pytest", "pytest"],
  ["unittest", "unittest"],
];

function findIn(haystack: string, table: [string, string][]): DetectionField<string> | undefined {
  const lower = haystack.toLowerCase();
  for (const [needle, label] of table) {
    if (lower.includes(needle)) return { value: label, confidence: "high" };
  }
  return undefined;
}

// Searching the whole pyproject.toml text (project name, URLs, script entry points, etc.)
// produces false positives — e.g. Flask's own pyproject.toml has `name = "flask"`, which
// isn't a dependency at all. Scope the search to the actual dependency declarations.
function extractPyprojectDependencySections(pyproject: string): string {
  const sections: string[] = [];

  const mainDeps = pyproject.match(/(?:^|\n)dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (mainDeps) sections.push(mainDeps[1]);

  const optionalDeps = pyproject.match(/\[project\.optional-dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (optionalDeps) sections.push(optionalDeps[1]);

  const dependencyGroups = pyproject.match(/\[dependency-groups\]([\s\S]*?)(?:\n\[|$)/);
  if (dependencyGroups) sections.push(dependencyGroups[1]);

  const poetryDepsBlocks = pyproject.match(/\[tool\.poetry(?:\.group\.\w+)?\.dependencies\]([\s\S]*?)(?:\n\[|$)/g);
  if (poetryDepsBlocks) sections.push(...poetryDepsBlocks);

  return sections.length > 0 ? sections.join("\n") : pyproject;
}

function isFrameworkSourceProject(pyproject: string): boolean {
  const projectBlock = pyproject.match(/(?:^|\n)\[project\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  const name = projectBlock?.match(/(?:^|\n)\s*name\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
  return FRAMEWORKS.some(([framework]) => framework === name);
}

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  if (!source) return null;

  const searchText = signals.pyprojectToml ? extractPyprojectDependencySections(signals.pyprojectToml) : source;

  const framework = findIn(searchText, FRAMEWORKS) ?? {
    value: "none",
    confidence: signals.pyprojectToml && isFrameworkSourceProject(signals.pyprojectToml)
      ? "high" as const
      : "low" as const,
  };
  const testRunner = findIn(searchText, TEST_RUNNERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.environmentYml
    ? { value: "conda", confidence: "high" }
    : signals.hasFile("uv.lock")
    ? { value: "uv", confidence: "high" }
    : signals.hasFile("poetry.lock")
    ? { value: "poetry", confidence: "high" }
    : signals.pyprojectToml
    ? { value: "pip (pyproject.toml)", confidence: "low" }
    : { value: "pip", confidence: "low" };

  return { packId: "python", language: "Python", framework, testRunner, packageManager };
}

const TEXTS: Record<Lang, { style: string; deps: string; arch: string[]; reviewFocus: string; refactorExtra: string }> = {
  es: {
    style: "Sigue PEP 8; usa type hints en funciones públicas.",
    deps: "No introduzcas dependencias nuevas sin añadirlas al manifiesto de dependencias existente.",
    arch: [
      "Mantén la lógica de negocio separada de la capa de framework cuando el proyecto ya siga ese patrón.",
      "Usa entornos virtuales; no instales paquetes globalmente.",
    ],
    reviewFocus: "manejo de excepciones incorrecto",
    refactorExtra: "Respeta los type hints existentes.",
  },
  en: {
    style: "Follow PEP 8; use type hints on public functions.",
    deps: "Do not introduce new dependencies without adding them to the existing dependency manifest.",
    arch: [
      "Keep business logic separate from the framework layer when the project already follows that pattern.",
      "Use virtual environments; never install packages globally.",
    ],
    reviewFocus: "incorrect exception handling",
    refactorExtra: "Respect the existing type hints.",
  },
};

function canonicalOf(ctx: PackContext | undefined, kind: CanonicalCommand["kind"]): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}

const FRAMEWORK_RISKS: Record<string, Record<Lang, string>> = {
  flask: {
    es: "Presta especial atención al contexto de aplicación/petición, los blueprints y el manejo de errores HTTP.",
    en: "Pay special attention to application/request context, blueprints and HTTP error handling.",
  },
  django: {
    es: "Presta especial atención a migraciones pendientes, consultas N+1 del ORM y validación en forms/serializers.",
    en: "Pay special attention to pending migrations, ORM N+1 queries and validation in forms/serializers.",
  },
  fastapi: {
    es: "Presta especial atención a los modelos Pydantic, las dependencias async y los códigos de respuesta declarados.",
    en: "Pay special attention to Pydantic models, async dependencies and declared response codes.",
  },
};

function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const testCmd = canonicalOf(ctx, "test")?.command ?? runner;
  return {
    summary: summarySentence(lang, "Python", framework),
    conventions: [t.style, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const test = canonicalOf(ctx, "test");
  const testDirs = ctx?.facts.testDirs ?? [];
  const hasTox = ctx?.facts.commands.some((c) => c.source === "tox") ?? false;
  const es = lang === "es";

  const reviewParts: string[] = [];
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones Python de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's Python conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test) {
    reviewParts.push(es ? `Ejecuta \`${test.command}\` antes de dar por buena la revisión.` : `Run \`${test.command}\` before approving the review.`);
  }
  if (hasTox) {
    reviewParts.push(es ? "La matriz completa de entornos se ejecuta con tox (`tox.ini`)." : "The full environment matrix runs through tox (`tox.ini`).");
  }
  const risk = framework ? FRAMEWORK_RISKS[framework]?.[lang] : undefined;
  if (risk) reviewParts.push(risk);
  reviewParts.push(es ? `Busca también bugs: ${t.reviewFocus}.` : `Also look for bugs: ${t.reviewFocus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(es ? "Señala solo hallazgos concretos con archivo y línea." : "Report only concrete findings with file and line references.");

  const testingParts: string[] = [testingBody(lang, runner)];
  if (test) testingParts.push(es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    { id: "review", title: "Code Review (Python)", body: ctx ? reviewParts.join(" ") : reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Python)", body: refactorBody(lang, t.refactorExtra) },
    { id: "testing", title: "Testing (Python)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}

export const pythonPack: Pack = { id: "python", detect, rules, promptTemplates };
