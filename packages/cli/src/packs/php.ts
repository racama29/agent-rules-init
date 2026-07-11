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
  type Lang,
} from "../core/i18n.js";

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

const TEXTS: Record<Lang, { style: string; deps: string; arch: string[] }> = {
  es: {
    style: "Sigue PSR-12 para el estilo de código.",
    deps: "Declara toda dependencia nueva en composer.json, nunca la instales sin registrarla.",
    arch: [
      "Respeta la estructura MVC del framework si el proyecto ya la sigue.",
      "Evita lógica de negocio en los controladores cuando el proyecto ya use capas de servicio.",
    ],
  },
  en: {
    style: "Follow PSR-12 for code style.",
    deps: "Declare every new dependency in composer.json; never install one without registering it.",
    arch: [
      "Respect the framework's MVC structure if the project already follows it.",
      "Avoid business logic in controllers when the project already uses service layers.",
    ],
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const testCmd = detection.testRunner?.value === "phpunit" ? "vendor/bin/phpunit" : undefined;
  return {
    summary: summarySentence(lang, "PHP", framework, "composer"),
    conventions: [t.style, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value === "phpunit" ? "PHPUnit" : undefined;
  return [
    { id: "review", title: "Code Review (PHP)", body: reviewBody(lang, "", framework) },
    { id: "refactor", title: "Refactor (PHP)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (PHP)", body: testingBody(lang, runner) },
  ];
}

export const phpPack: Pack = { id: "php", detect, rules, promptTemplates };
