import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";
import {
  refactorBody,
  reviewBody,
  runTestsConvention,
  summarySentence,
  testingBody,
  type Lang,
} from "../core/i18n.js";

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

const TEXTS: Record<
  Lang,
  { style: string; deps: string; archFlutter: string; archPlain: string; immutability: string }
> = {
  es: {
    style: "Sigue la guía de estilo oficial de Dart (dart.dev/effective-dart/style).",
    deps: "Declara toda dependencia nueva en pubspec.yaml, nunca la instales sin registrarla.",
    archFlutter:
      "Separa la lógica de negocio de los widgets cuando el proyecto ya siga ese patrón (p. ej. BLoC/Provider/Riverpod).",
    archPlain: "Mantén los módulos con una responsabilidad clara.",
    immutability: "Prefiere `final`/`const` sobre variables mutables cuando sea posible.",
  },
  en: {
    style: "Follow the official Dart style guide (dart.dev/effective-dart/style).",
    deps: "Declare every new dependency in pubspec.yaml; never install one without registering it.",
    archFlutter:
      "Keep business logic out of widgets when the project already follows that pattern (e.g. BLoC/Provider/Riverpod).",
    archPlain: "Keep modules single-purpose.",
    immutability: "Prefer `final`/`const` over mutable variables when possible.",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return {
    summary: summarySentence(lang, "Dart", framework, "pub"),
    conventions: [t.style, runTestsConvention(lang, runner), t.deps],
    architectureNotes: [framework === "flutter" ? t.archFlutter : t.archPlain, t.immutability],
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return [
    { id: "review", title: "Code Review (Dart)", body: reviewBody(lang, "", framework) },
    { id: "refactor", title: "Refactor (Dart)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Dart)", body: testingBody(lang, runner) },
  ];
}

export const dartPack: Pack = { id: "dart", detect, rules, promptTemplates };
