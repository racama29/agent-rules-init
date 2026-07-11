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
  const source = signals.buildGradle;
  if (!source) return null;
  // Modern Gradle projects often declare the Kotlin plugin via a version catalog alias
  // (`alias(libs.plugins.kotlin.android)`) rather than the literal `kotlin("jvm")` or
  // `org.jetbrains.kotlin` plugin id, so a plain word-boundary check is more robust.
  if (!/\bkotlin\b/i.test(source)) return null;

  const framework: DetectionResult["framework"] = /ktor/i.test(source)
    ? { value: "ktor", confidence: "high" }
    : /com\.android\.application|com\.android\.library/i.test(source)
    ? { value: "android", confidence: "high" }
    : /spring/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const testRunner: DetectionResult["testRunner"] = /kotlin\.test|kotest/i.test(source)
    ? { value: "kotest", confidence: "high" }
    : /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "kotlin",
    language: "Kotlin",
    framework,
    testRunner,
    packageManager: { value: "gradle", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; nullsafety: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue las convenciones de estilo oficiales de Kotlin (kotlinlang.org/docs/coding-conventions.html).",
    nullsafety: "Prefiere tipos no-nulos y `val` sobre `var` salvo que la mutabilidad sea necesaria.",
    arch: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
    reviewFocus: "uso innecesario de `!!`",
  },
  en: {
    style: "Follow the official Kotlin style conventions (kotlinlang.org/docs/coding-conventions.html).",
    nullsafety: "Prefer non-null types and `val` over `var` unless mutability is required.",
    arch: [
      "Respect the layered separation (controller/service/repository) if the project already uses it.",
      "Prefer dependency injection over manual instantiation when the framework already provides it.",
    ],
    reviewFocus: "unnecessary `!!` usage",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Kotlin", framework, "gradle"),
    conventions: [t.style, runTestsConvention(lang, "`gradle test`"), t.nullsafety],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (Kotlin)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Kotlin)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Kotlin)", body: testingBody(lang, runner) },
  ];
}

export const kotlinPack: Pack = { id: "kotlin", detect, rules, promptTemplates };
