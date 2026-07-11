import type {
  DetectionField,
  DetectionResult,
  Pack,
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

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return {
    summary: summarySentence(lang, "Python", framework),
    conventions: [t.style, runTestsConvention(lang, runner), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return [
    { id: "review", title: "Code Review (Python)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Python)", body: refactorBody(lang, t.refactorExtra) },
    { id: "testing", title: "Testing (Python)", body: testingBody(lang, runner) },
  ];
}

export const pythonPack: Pack = { id: "python", detect, rules, promptTemplates };
