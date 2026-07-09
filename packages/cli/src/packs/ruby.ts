import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.gemfile;
  if (!source) return null;
  const lower = source.toLowerCase();

  const framework: DetectionField<string> = /gem\s+['"]rails['"]/.test(lower)
    ? { value: "rails", confidence: "high" }
    : /gem\s+['"]sinatra['"]/.test(lower)
    ? { value: "sinatra", confidence: "high" }
    : { value: "none", confidence: "low" };

  const testRunner: DetectionField<string> = /gem\s+['"]rspec/.test(lower)
    ? { value: "rspec", confidence: "high" }
    : /gem\s+['"]minitest['"]/.test(lower)
    ? { value: "minitest", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "ruby",
    language: "Ruby",
    framework,
    testRunner,
    packageManager: { value: "bundler", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Ruby${framework !== "none" ? ` con ${framework}` : ""} (bundler).`,
    conventions: [
      "Sigue la guía de estilo Ruby estándar (snake_case para métodos/variables, CamelCase para clases).",
      `Ejecuta los tests con ${detection.testRunner?.value === "rspec" ? "bundle exec rspec" : detection.testRunner?.value === "minitest" ? "bundle exec rake test" : "el test runner del proyecto"} antes de terminar una tarea.`,
      "Declara toda dependencia nueva en el Gemfile, nunca instales una gema sin registrarla.",
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
      title: "Code Review (Ruby)",
      body: `Revisa el diff actual buscando bugs y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Ruby)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Ruby)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const rubyPack: Pack = { id: "ruby", detect, rules, promptTemplates };
