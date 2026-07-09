import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.mixExs;
  if (!source) return null;
  const lower = source.toLowerCase();

  const framework: DetectionResult["framework"] = lower.includes(":phoenix")
    ? { value: "phoenix", confidence: "high" }
    : { value: "none", confidence: "low" };

  return {
    packId: "elixir",
    language: "Elixir",
    framework,
    testRunner: { value: "mix test", confidence: "high" },
    packageManager: { value: "mix", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Elixir${framework !== "none" ? ` con ${framework}` : ""} (mix).`,
    conventions: [
      "Sigue la guía de estilo oficial de Elixir; ejecuta `mix format` antes de terminar una tarea.",
      "Ejecuta los tests con `mix test` antes de terminar una tarea.",
      "Prefiere pattern matching y pipelines (`|>`) sobre anidar llamadas de función.",
    ],
    architectureNotes: [
      "Respeta la separación entre contextos (lógica de negocio) y la capa web si el proyecto ya usa Phoenix.",
      "Declara toda dependencia nueva en `mix.exs` y mantén `mix.lock` sincronizado.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Elixir)",
      body: `Revisa el diff actual buscando bugs, procesos sin supervisar correctamente y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Elixir)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Elixir)",
      body: `Escribe tests con \`mix test\` (ExUnit) para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const elixirPack: Pack = { id: "elixir", detect, rules, promptTemplates };
