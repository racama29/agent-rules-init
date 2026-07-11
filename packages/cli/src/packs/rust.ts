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
  ["actix-web", "actix-web"],
  ["axum", "axum"],
  ["rocket", "rocket"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.cargoToml;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  return {
    packId: "rust",
    language: "Rust",
    framework,
    testRunner: { value: "cargo test", confidence: "high" },
    packageManager: { value: "cargo", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; unwrap: string; arch: string[]; reviewFocus: string; refactorExtra: string }> = {
  es: {
    style: "Sigue el formato estándar de `rustfmt`; corre `cargo clippy` para detectar problemas idiomáticos.",
    unwrap: "Evita `unwrap()`/`expect()` en código de producción salvo que la invariante esté justificada.",
    arch: [
      "Mantén los módulos con una responsabilidad clara; usa `mod.rs` o archivos de módulo con nombre explícito según lo que ya use el repo.",
      "Declara toda dependencia nueva en Cargo.toml y mantén Cargo.lock sincronizado.",
    ],
    reviewFocus: "usos innecesarios de `unwrap()`/`clone()`",
    refactorExtra: "Respeta el sistema de ownership existente.",
  },
  en: {
    style: "Follow the standard `rustfmt` formatting; run `cargo clippy` to catch idiomatic issues.",
    unwrap: "Avoid `unwrap()`/`expect()` in production code unless the invariant is justified.",
    arch: [
      "Keep modules single-purpose; use `mod.rs` or explicitly named module files following what the repo already uses.",
      "Declare every new dependency in Cargo.toml and keep Cargo.lock in sync.",
    ],
    reviewFocus: "unnecessary uses of `unwrap()`/`clone()`",
    refactorExtra: "Respect the existing ownership model.",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Rust", framework, "cargo"),
    conventions: [t.style, runTestsConvention(lang, "`cargo test`"), t.unwrap],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return [
    { id: "review", title: "Code Review (Rust)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Rust)", body: refactorBody(lang, t.refactorExtra) },
    { id: "testing", title: "Testing (Rust)", body: testingBody(lang, "`cargo test`") },
  ];
}

export const rustPack: Pack = { id: "rust", detect, rules, promptTemplates };
