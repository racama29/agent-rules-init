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

const FRAMEWORKS: [string, string][] = [
  ["shiny", "shiny"],
  ["plumber", "plumber"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.rDescription ?? signals.renvLock;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  const testRunner: DetectionResult["testRunner"] = lower.includes("testthat")
    ? { value: "testthat", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  const packageManager: DetectionResult["packageManager"] = signals.renvLock
    ? { value: "renv", confidence: "high" }
    : { value: "CRAN", confidence: "low" };

  return { packId: "r", language: "R", framework, testRunner, packageManager };
}

const TEXTS: Record<Lang, { style: string; deps: string; arch: string[] }> = {
  es: {
    style: "Sigue la guía de estilo tidyverse (style.tidyverse.org) salvo que el proyecto ya use otra.",
    deps: "Declara toda dependencia nueva en DESCRIPTION y actualiza renv.lock si el proyecto usa renv.",
    arch: [
      "Mantén las funciones puras y con una responsabilidad clara; evita modificar el entorno global.",
      "Separa el análisis/scripts de la lógica reutilizable empaquetada en funciones.",
    ],
  },
  en: {
    style: "Follow the tidyverse style guide (style.tidyverse.org) unless the project already uses another one.",
    deps: "Declare every new dependency in DESCRIPTION and update renv.lock if the project uses renv.",
    arch: [
      "Keep functions pure and single-purpose; avoid mutating the global environment.",
      "Separate analysis/scripts from reusable logic packaged as functions.",
    ],
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const testCmd =
    detection.testRunner?.value === "testthat" ? 'testthat::test_dir("tests")' : unknownRunnerLabel(lang);
  return {
    summary: summarySentence(lang, "R", framework, detection.packageManager?.value),
    conventions: [t.style, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (R)", body: reviewBody(lang, "", framework) },
    { id: "refactor", title: "Refactor (R)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (R)", body: testingBody(lang, runner) },
  ];
}

export const rPack: Pack = { id: "r", detect, rules, promptTemplates };
