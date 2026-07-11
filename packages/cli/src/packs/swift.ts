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
  const source = signals.packageSwift;
  if (!source) return null;
  // A Package.swift alone doesn't guarantee a Swift project: some C/C++ libraries (e.g.
  // nlohmann/json) ship one purely so Swift Package Manager users can link the library,
  // with zero actual Swift source. Require at least one other .swift file to be present.
  const hasSwiftSource = signals.files.some(
    (f) => f.toLowerCase().endsWith(".swift") && !f.endsWith("Package.swift")
  );
  if (!hasSwiftSource) return null;
  const lower = source.toLowerCase();

  const framework: DetectionResult["framework"] = lower.includes("vapor")
    ? { value: "vapor", confidence: "high" }
    : { value: "none", confidence: "low" };

  return {
    packId: "swift",
    language: "Swift",
    framework,
    testRunner: { value: "swift test", confidence: "high" },
    packageManager: { value: "swift package manager", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; deps: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue la guía de estilo de la API de Swift (swift.org/documentation/api-design-guidelines).",
    deps: "Declara toda dependencia nueva en Package.swift, nunca la añadas solo en Xcode.",
    arch: [
      "Prefiere `struct` sobre `class` salvo que se necesite semántica de referencia.",
      "Evita forzar el desenvuelto de opcionales (`!`) fuera de contextos donde la invariante esté garantizada.",
    ],
    reviewFocus: "desenvueltos forzados de opcionales",
  },
  en: {
    style: "Follow the Swift API design guidelines (swift.org/documentation/api-design-guidelines).",
    deps: "Declare every new dependency in Package.swift; never add it only in Xcode.",
    arch: [
      "Prefer `struct` over `class` unless reference semantics are needed.",
      "Avoid force-unwrapping optionals (`!`) outside contexts where the invariant is guaranteed.",
    ],
    reviewFocus: "force-unwrapped optionals",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Swift", framework, "Swift Package Manager"),
    conventions: [t.style, runTestsConvention(lang, "`swift test`"), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return [
    { id: "review", title: "Code Review (Swift)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Swift)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Swift)", body: testingBody(lang, "`swift test`") },
  ];
}

export const swiftPack: Pack = { id: "swift", detect, rules, promptTemplates };
