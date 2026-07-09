import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.packageSwift;
  if (!source) return null;
  const lower = source.toLowerCase();

  const framework: DetectionResult["framework"] = lower.includes("vapor")
    ? { value: "vapor", confidence: "high" }
    : { value: "none", confidence: "low" };

  return {
    packId: "swift",
    language: "Swift",
    framework,
    testRunner: { value: "swift test", confidence: "high" },
    packageManager: { value: "swift package manager", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Swift${framework !== "none" ? ` con ${framework}` : ""} (Swift Package Manager).`,
    conventions: [
      "Sigue la guía de estilo de la API de Swift (swift.org/documentation/api-design-guidelines).",
      "Ejecuta los tests con `swift test` antes de terminar una tarea.",
      "Declara toda dependencia nueva en Package.swift, nunca la añadas solo en Xcode.",
    ],
    architectureNotes: [
      "Prefiere `struct` sobre `class` salvo que se necesite semántica de referencia.",
      "Evita forzar el desenvuelto de opcionales (`!`) fuera de contextos donde la invariante esté garantizada.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Swift)",
      body: `Revisa el diff actual buscando bugs, desenvueltos forzados de opcionales y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Swift)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Swift)",
      body: `Escribe tests con \`swift test\` para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const swiftPack: Pack = { id: "swift", detect, rules, promptTemplates };
