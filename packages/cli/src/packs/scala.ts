import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";
import {
  refactorBody,
  reviewBody,
  runTestsConvention,
  summarySentence,
  testingBody,
  type Lang,
} from "../core/i18n.js";

const FRAMEWORKS: [string, string][] = [
  ["playframework", "play"],
  ["akka-http", "akka"],
  ["akka.actor", "akka"],
  ["scalatra", "scalatra"],
];

const TEST_RUNNERS: [string, string][] = [
  ["scalatest", "scalatest"],
  ["munit", "munit"],
  ["specs2", "specs2"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.buildSbt;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  let testRunner: DetectionResult["testRunner"] = { value: "unknown", confidence: "low" };
  for (const [needle, label] of TEST_RUNNERS) {
    if (lower.includes(needle)) {
      testRunner = { value: label, confidence: "high" };
      break;
    }
  }

  return {
    packId: "scala",
    language: "Scala",
    framework,
    testRunner,
    packageManager: { value: "sbt", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; immutability: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue la guía de estilo oficial de Scala; ejecuta `scalafmt` si el proyecto ya lo usa.",
    immutability: "Prefiere estructuras inmutables y funciones puras cuando el proyecto ya siga ese estilo.",
    arch: [
      "Mantén los módulos con una responsabilidad clara; usa `case class` para modelos de datos.",
      "Declara toda dependencia nueva en `build.sbt`.",
    ],
    reviewFocus: "usos innecesarios de mutabilidad",
  },
  en: {
    style: "Follow the official Scala style guide; run `scalafmt` if the project already uses it.",
    immutability: "Prefer immutable structures and pure functions when the project already follows that style.",
    arch: [
      "Keep modules single-purpose; use `case class` for data models.",
      "Declare every new dependency in `build.sbt`.",
    ],
    reviewFocus: "unnecessary mutability",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Scala", framework, "sbt"),
    conventions: [t.style, runTestsConvention(lang, "`sbt test`"), t.immutability],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return [
    { id: "review", title: "Code Review (Scala)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Scala)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Scala)", body: testingBody(lang, runner) },
  ];
}

export const scalaPack: Pack = { id: "scala", detect, rules, promptTemplates };
