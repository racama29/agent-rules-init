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

const TEXTS: Record<Lang, { style: string; deps: string; arch: string[] }> = {
  es: {
    style: "Sigue la guía de estilo Ruby estándar (snake_case para métodos/variables, CamelCase para clases).",
    deps: "Declara toda dependencia nueva en el Gemfile, nunca instales una gema sin registrarla.",
    arch: [
      "Respeta la estructura MVC del framework si el proyecto ya la sigue.",
      "Evita lógica de negocio en los controladores cuando el proyecto ya use capas de servicio.",
    ],
  },
  en: {
    style: "Follow the standard Ruby style guide (snake_case for methods/variables, CamelCase for classes).",
    deps: "Declare every new dependency in the Gemfile; never install a gem without registering it.",
    arch: [
      "Respect the framework's MVC structure if the project already follows it.",
      "Avoid business logic in controllers when the project already uses service layers.",
    ],
  },
};

function testCommand(detection: DetectionResult, lang: Lang): string {
  if (detection.testRunner?.value === "rspec") return "bundle exec rspec";
  if (detection.testRunner?.value === "minitest") return "bundle exec rake test";
  return unknownRunnerLabel(lang);
}

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Ruby", framework, "bundler"),
    conventions: [t.style, runTestsConvention(lang, testCommand(detection, lang)), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (Ruby)", body: reviewBody(lang, "", framework) },
    { id: "refactor", title: "Refactor (Ruby)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Ruby)", body: testingBody(lang, runner) },
  ];
}

export const rubyPack: Pack = { id: "ruby", detect, rules, promptTemplates };
