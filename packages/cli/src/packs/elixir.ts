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
  const source = signals.mixExs;
  if (!source) return null;
  const lower = source.toLowerCase();

  // A plain `.includes(":phoenix")` also matches sibling hex packages like `:phoenix_pubsub`
  // or `:phoenix_html` (substring prefix), and Phoenix's own mix.exs (`app: :phoenix`) —
  // neither means the project actually depends on the `phoenix` package. Match the
  // `{:phoenix, ...}` dependency-tuple syntax instead, which only the real dependency uses.
  const framework: DetectionResult["framework"] = /\{\s*:phoenix\s*,/.test(lower)
    ? { value: "phoenix", confidence: "high" }
    : { value: "none", confidence: "low" };

  return {
    packId: "elixir",
    language: "Elixir",
    framework,
    testRunner: { value: "mix test", confidence: "high" },
    packageManager: { value: "mix", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; patterns: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue la guía de estilo oficial de Elixir; ejecuta `mix format` antes de terminar una tarea.",
    patterns: "Prefiere pattern matching y pipelines (`|>`) sobre anidar llamadas de función.",
    arch: [
      "Respeta la separación entre contextos (lógica de negocio) y la capa web si el proyecto ya usa Phoenix.",
      "Declara toda dependencia nueva en `mix.exs` y mantén `mix.lock` sincronizado.",
    ],
    reviewFocus: "procesos sin supervisar correctamente",
  },
  en: {
    style: "Follow the official Elixir style guide; run `mix format` before finishing a task.",
    patterns: "Prefer pattern matching and pipelines (`|>`) over nesting function calls.",
    arch: [
      "Respect the separation between contexts (business logic) and the web layer if the project already uses Phoenix.",
      "Declare every new dependency in `mix.exs` and keep `mix.lock` in sync.",
    ],
    reviewFocus: "improperly supervised processes",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return {
    summary: summarySentence(lang, "Elixir", framework, "mix"),
    conventions: [t.style, runTestsConvention(lang, "`mix test`"), t.patterns],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  return [
    { id: "review", title: "Code Review (Elixir)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Elixir)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Elixir)", body: testingBody(lang, "`mix test` (ExUnit)") },
  ];
}

export const elixirPack: Pack = { id: "elixir", detect, rules, promptTemplates };
