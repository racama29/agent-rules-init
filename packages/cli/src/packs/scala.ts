import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

const FRAMEWORKS: [string, string][] = [
  ["playframework", "play"],
  ["akka-http", "akka"],
  ["akka.actor", "akka"],
];

const TEST_RUNNERS: [string, string][] = [
  ["scalatest", "scalatest"],
  ["munit", "munit"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.buildSbt;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  let testRunner: DetectionResult["testRunner"] = { value: "unknown", confidence: "low" };
  for (const [needle, label] of TEST_RUNNERS) {
    if (lower.includes(needle)) {
      testRunner = { value: label, confidence: "high" };
      break;
    }
  }

  return {
    packId: "scala",
    language: "Scala",
    framework,
    testRunner,
    packageManager: { value: "sbt", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Scala${framework !== "none" ? ` con ${framework}` : ""} (sbt).`,
    conventions: [
      "Sigue la guía de estilo oficial de Scala; ejecuta `scalafmt` si el proyecto ya lo usa.",
      `Ejecuta los tests con \`sbt test\` antes de terminar una tarea.`,
      "Prefiere estructuras inmutables y funciones puras cuando el proyecto ya siga ese estilo.",
    ],
    architectureNotes: [
      "Mantén los módulos con una responsabilidad clara; usa `case class` para modelos de datos.",
      "Declara toda dependencia nueva en `build.sbt`.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Scala)",
      body: `Revisa el diff actual buscando bugs, usos innecesarios de mutabilidad y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Scala)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Scala)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const scalaPack: Pack = { id: "scala", detect, rules, promptTemplates };
