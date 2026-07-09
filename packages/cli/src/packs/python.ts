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

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  if (!source) return null;

  const framework = findIn(source, FRAMEWORKS) ?? { value: "none", confidence: "low" as const };
  const testRunner = findIn(source, TEST_RUNNERS) ?? { value: "unknown", confidence: "low" as const };
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
