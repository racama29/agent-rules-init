import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.csproj;
  if (!source) return null;
  const lower = source.toLowerCase();

  const framework: DetectionResult["framework"] = lower.includes("microsoft.aspnetcore")
    ? { value: "aspnet-core", confidence: "high" }
    : { value: "none", confidence: "low" };

  const testRunner: DetectionResult["testRunner"] = lower.includes("xunit")
    ? { value: "xunit", confidence: "high" }
    : lower.includes("nunit")
    ? { value: "nunit", confidence: "high" }
    : lower.includes("mstest")
    ? { value: "mstest", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "csharp",
    language: "C#",
    framework,
    testRunner,
    packageManager: { value: "nuget", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto C#/.NET${framework !== "none" ? ` con ${framework}` : ""} (NuGet).`,
    conventions: [
      "Sigue las convenciones de nombrado de .NET (PascalCase para clases/métodos públicos, camelCase para variables locales).",
      `Ejecuta los tests con \`dotnet test\` antes de terminar una tarea.`,
      "Declara toda dependencia nueva vía NuGet en el .csproj, nunca la añadas manualmente sin registrarla.",
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
      title: "Code Review (C#/.NET)",
      body: `Revisa el diff actual buscando bugs, null-safety y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (C#/.NET)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (C#/.NET)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const csharpPack: Pack = { id: "csharp", detect, rules, promptTemplates };
