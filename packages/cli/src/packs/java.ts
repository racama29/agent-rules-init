import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";
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
  const source = signals.pomXml ?? signals.buildGradle;
  if (!source) return null;
  // A Gradle build that applies the Kotlin plugin is a Kotlin project, not Java —
  // defer entirely to the Kotlin pack instead of also reporting a spurious Java match.
  // Modern Gradle projects often declare plugins via version catalogs
  // (`alias(libs.plugins.kotlin.android)`) rather than the literal `kotlin("jvm")` or
  // `org.jetbrains.kotlin` plugin id, so a plain word-boundary check on "kotlin" is
  // more robust than trying to match every DSL style.
  if (
    (signals.buildGradle && /\bkotlin\b/i.test(signals.buildGradle)) ||
    (signals.pomXml && /\bkotlin\b/i.test(signals.pomXml))
  ) return null;

  const framework: DetectionField<string> = /spring/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const packageManager: DetectionField<string> = signals.pomXml
    ? signals.hasFile("mvnw") || signals.hasFile("mvnw.cmd")
      ? { value: "maven wrapper", confidence: "high" }
      : { value: "maven", confidence: "high" }
    : signals.hasFile("gradlew") || signals.hasFile("gradlew.bat")
    ? { value: "gradle wrapper", confidence: "high" }
    : { value: "gradle", confidence: "high" };

  const testRunner: DetectionField<string> = /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return { packId: "java", language: "Java", framework, packageManager, testRunner };
}

const TEXTS: Record<Lang, { naming: string; deps: string; arch: string[]; reviewFocus: string }> = {
  es: {
    naming: "Sigue las convenciones de nombrado estándar de Java (PascalCase para clases, camelCase para métodos).",
    deps: "No añadas dependencias nuevas sin declararlas en el gestor de build existente.",
    arch: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
    reviewFocus: "null-safety",
  },
  en: {
    naming: "Follow standard Java naming conventions (PascalCase for classes, camelCase for methods).",
    deps: "Do not add new dependencies without declaring them in the existing build tool.",
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
  const testCmd = detection.packageManager?.value === "maven wrapper"
    ? "./mvnw test"
    : detection.packageManager?.value === "maven"
    ? "mvn test"
    : detection.packageManager?.value === "gradle wrapper"
    ? "./gradlew test"
    : "gradle test";
  return {
    summary: summarySentence(lang, "Java", framework, detection.packageManager?.value),
    conventions: [t.naming, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (Java)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Java)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Java)", body: testingBody(lang, runner) },
  ];
}

export const javaPack: Pack = { id: "java", detect, rules, promptTemplates };
