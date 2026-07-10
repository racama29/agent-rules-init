import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";

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

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  if (!source) return null;

  const searchText = signals.pyprojectToml ? extractPyprojectDependencySections(signals.pyprojectToml) : source;

  const framework = findIn(searchText, FRAMEWORKS) ?? { value: "none", confidence: "low" as const };
  const testRunner = findIn(searchText, TEST_RUNNERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.environmentYml
    ? { value: "conda", confidence: "high" }
    : signals.hasFile("poetry.lock")
    ? { value: "poetry", confidence: "high" }
    : signals.pyprojectToml
    ? { value: "pip (pyproject.toml)", confidence: "low" }
    : { value: "pip", confidence: "low" };

  return { packId: "python", language: "Python", framework, testRunner, packageManager };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Python${framework !== "none" ? ` con ${framework}` : ""}.`,
    conventions: [
      "Sigue PEP 8; usa type hints en funciones públicas.",
      `Ejecuta los tests con ${detection.testRunner?.value ?? "el test runner del proyecto"} antes de terminar una tarea.`,
      "No introduzcas dependencias nuevas sin añadirlas al manifiesto de dependencias existente.",
    ],
    architectureNotes: [
      "Mantén la lógica de negocio separada de la capa de framework cuando el proyecto ya siga ese patrón.",
      "Usa entornos virtuales; no instales paquetes globalmente.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Python)",
      body: `Revisa el diff actual buscando bugs, manejo de excepciones incorrecto y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Python)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable. Respeta los type hints existentes.`,
    },
    {
      id: "testing",
      title: "Testing (Python)",
      body: `Escribe tests para el código señalado usando ${detection.testRunner?.value ?? "el test runner del proyecto"}. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const pythonPack: Pack = { id: "python", detect, rules, promptTemplates };
