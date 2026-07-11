import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";
import {
  refactorBody,
  reviewBody,
  runTestsConvention,
  summarySentence,
  testingBody,
  unknownFrameworkLabel,
  unknownRunnerLabel,
  type Lang,
} from "../core/i18n.js";

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

const TEXTS: Record<Lang, { naming: string; deps: string; arch: string[]; reviewFocus: string }> = {
  es: {
    naming:
      "Sigue las convenciones de nombrado de .NET (PascalCase para clases/métodos públicos, camelCase para variables locales).",
    deps: "Declara toda dependencia nueva vía NuGet en el .csproj, nunca la añadas manualmente sin registrarla.",
    arch: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
    reviewFocus: "null-safety",
  },
  en: {
    naming: ".NET naming conventions apply (PascalCase for classes/public methods, camelCase for local variables).",
    deps: "Declare every new dependency via NuGet in the .csproj; never add it manually without registering it.",
    arch: [
      "Respect the layered separation (controller/service/repository) if the project already uses it.",
      "Prefer dependency injection over manual instantiation when the framework already provides it.",
    ],
    reviewFocus: "null-safety",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "C#/.NET", framework, "NuGet"),
    conventions: [t.naming, runTestsConvention(lang, "`dotnet test`"), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (C#/.NET)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (C#/.NET)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (C#/.NET)", body: testingBody(lang, runner) },
  ];
}

export const csharpPack: Pack = { id: "csharp", detect, rules, promptTemplates };
