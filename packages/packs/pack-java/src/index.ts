import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "agent-rules-pack-types";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pomXml ?? signals.buildGradle;
  if (!source) return null;

  const framework: DetectionField<string> = /spring/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const packageManager: DetectionField<string> = signals.pomXml
    ? { value: "maven", confidence: "high" }
    : { value: "gradle", confidence: "high" };

  const testRunner: DetectionField<string> = /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return { packId: "java", language: "Java", framework, packageManager, testRunner };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Java${framework !== "none" ? ` con ${framework}` : ""} (${detection.packageManager?.value}).`,
    conventions: [
      "Sigue las convenciones de nombrado estándar de Java (PascalCase para clases, camelCase para métodos).",
      `Ejecuta los tests con ${detection.packageManager?.value === "maven" ? "mvn test" : "gradle test"} antes de terminar una tarea.`,
      "No añadas dependencias nuevas sin declararlas en el gestor de build existente.",
    ],
    architectureNotes: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Java)",
      body: `Revisa el diff actual buscando bugs, null-safety y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Java)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Java)",
      body: `Escribe tests con ${detection.testRunner?.value ?? "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const javaPack: Pack = { id: "java", detect, rules, promptTemplates };
