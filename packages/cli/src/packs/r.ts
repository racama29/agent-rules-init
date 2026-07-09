import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

const FRAMEWORKS: [string, string][] = [
  ["shiny", "shiny"],
  ["plumber", "plumber"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.rDescription ?? signals.renvLock;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  const testRunner: DetectionResult["testRunner"] = lower.includes("testthat")
    ? { value: "testthat", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  const packageManager: DetectionResult["packageManager"] = signals.renvLock
    ? { value: "renv", confidence: "high" }
    : { value: "CRAN", confidence: "low" };

  return { packId: "r", language: "R", framework, testRunner, packageManager };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto R${framework !== "none" ? ` con ${framework}` : ""} (${detection.packageManager?.value}).`,
    conventions: [
      "Sigue la guía de estilo tidyverse (style.tidyverse.org) salvo que el proyecto ya use otra.",
      `Ejecuta los tests con ${detection.testRunner?.value === "testthat" ? "testthat::test_dir(\"tests\")" : "el test runner del proyecto"} antes de terminar una tarea.`,
      "Declara toda dependencia nueva en DESCRIPTION y actualiza renv.lock si el proyecto usa renv.",
    ],
    architectureNotes: [
      "Mantén las funciones puras y con una responsabilidad clara; evita modificar el entorno global.",
      "Separa el análisis/scripts de la lógica reutilizable empaquetada en funciones.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (R)",
      body: `Revisa el diff actual buscando bugs y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (R)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (R)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const rPack: Pack = { id: "r", detect, rules, promptTemplates };
