import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pubspecYaml;
  if (!source) return null;
  const lower = source.toLowerCase();

  const framework: DetectionResult["framework"] = /^\s*flutter\s*:/m.test(lower)
    ? { value: "flutter", confidence: "high" }
    : lower.includes("shelf")
    ? { value: "shelf", confidence: "high" }
    : { value: "none", confidence: "low" };

  const testRunner: DetectionResult["testRunner"] = lower.includes("flutter_test")
    ? { value: "flutter test", confidence: "high" }
    : /^\s*test\s*:/m.test(lower)
    ? { value: "dart test", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "dart",
    language: "Dart",
    framework,
    testRunner,
    packageManager: { value: "pub", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Dart${framework !== "none" ? ` con ${framework}` : ""} (pub).`,
    conventions: [
      "Sigue la guía de estilo oficial de Dart (dart.dev/effective-dart/style).",
      `Ejecuta los tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} antes de terminar una tarea.`,
      "Declara toda dependencia nueva en pubspec.yaml, nunca la instales sin registrarla.",
    ],
    architectureNotes: [
      framework === "flutter"
        ? "Separa la lógica de negocio de los widgets cuando el proyecto ya siga ese patrón (p. ej. BLoC/Provider/Riverpod)."
        : "Mantén los módulos con una responsabilidad clara.",
      "Prefiere `final`/`const` sobre variables mutables cuando sea posible.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Dart)",
      body: `Revisa el diff actual buscando bugs y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Dart)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Dart)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const dartPack: Pack = { id: "dart", detect, rules, promptTemplates };
