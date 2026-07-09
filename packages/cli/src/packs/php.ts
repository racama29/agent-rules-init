import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";

const FRAMEWORKS: Record<string, string> = {
  "laravel/framework": "laravel",
  "symfony/symfony": "symfony",
  "codeigniter4/framework": "codeigniter",
};

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.composerJson) return null;
  const allDeps = { ...signals.composerJson.require, ...signals.composerJson.requireDev };

  let framework: DetectionField<string> = { value: "none", confidence: "low" };
  for (const [dep, label] of Object.entries(FRAMEWORKS)) {
    if (allDeps[dep]) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  const testRunner: DetectionField<string> = allDeps["phpunit/phpunit"]
    ? { value: "phpunit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "php",
    language: "PHP",
    framework,
    testRunner,
    packageManager: { value: "composer", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto PHP${framework !== "none" ? ` con ${framework}` : ""} (composer).`,
    conventions: [
      "Sigue PSR-12 para el estilo de código.",
      `Ejecuta los tests con ${detection.testRunner?.value === "phpunit" ? "vendor/bin/phpunit" : "el test runner del proyecto"} antes de terminar una tarea.`,
      "Declara toda dependencia nueva en composer.json, nunca la instales sin registrarla.",
    ],
    architectureNotes: [
      "Respeta la estructura MVC del framework si el proyecto ya la sigue.",
      "Evita lógica de negocio en los controladores cuando el proyecto ya use capas de servicio.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (PHP)",
      body: `Revisa el diff actual buscando bugs y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (PHP)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (PHP)",
      body: `Escribe tests con ${detection.testRunner?.value === "phpunit" ? "PHPUnit" : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const phpPack: Pack = { id: "php", detect, rules, promptTemplates };
