import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";
import {
  refactorBody,
  reviewBody,
  runTestsConvention,
  summarySentence,
  testingBody,
  type Lang,
} from "../core/i18n.js";
import { detectNamedSignal, detectedName } from "./pack-helpers.js";

const FRAMEWORKS: [string, string][] = [
  ["gin-gonic/gin", "gin"],
  ["labstack/echo", "echo"],
  ["gofiber/fiber", "fiber"],
  ["go-chi/chi", "chi"],
];

// The `module` line of go.mod is the project's own import path, not a dependency —
// searching the whole file would false-positive on a framework whose own repo module
// path happens to match a known framework name (e.g. gofiber/fiber's own go.mod
// declares `module github.com/gofiber/fiber/v3`). Scope the search to `require` entries.
function extractGoRequireSection(goMod: string): string {
  const sections: string[] = [];
  for (const m of goMod.matchAll(/require\s*\(([\s\S]*?)\)/g)) sections.push(m[1]);
  for (const m of goMod.matchAll(/^require\s+(?!\()(.+)$/gm)) sections.push(m[1]);
  return sections.length > 0 ? sections.join("\n") : goMod;
}

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.goMod;
  if (!source) return null;
  const framework = detectNamedSignal(extractGoRequireSection(source), FRAMEWORKS);

  return {
    packId: "go",
    language: "Go",
    framework,
    testRunner: { value: "go test", confidence: "high" },
    packageManager: { value: "go modules", confidence: "high" },
  };
}

const TEXTS: Record<Lang, { style: string; errors: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue el formato estándar de `gofmt`; no introduzcas estilos alternativos.",
    errors: "Maneja los errores explícitamente (`if err != nil`); no los ignores en silencio.",
    arch: [
      "Mantén los paquetes con una responsabilidad clara; evita paquetes `util` genéricos.",
      "Declara toda dependencia nueva vía `go get` y mantén `go.mod`/`go.sum` sincronizados.",
    ],
    reviewFocus: "manejo de errores omitido",
  },
  en: {
    style: "Follow the standard `gofmt` formatting; do not introduce alternative styles.",
    errors: "Handle errors explicitly (`if err != nil`); never ignore them silently.",
    arch: [
      "Keep packages single-purpose; avoid generic `util` packages.",
      "Declare every new dependency via `go get` and keep `go.mod`/`go.sum` in sync.",
    ],
    reviewFocus: "missing error handling",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detectedName(detection.framework);
  return {
    summary: summarySentence(lang, "Go", framework, "go modules"),
    conventions: [t.style, runTestsConvention(lang, "`go test ./...`"), t.errors],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detectedName(detection.framework);
  return [
    { id: "review", title: "Code Review (Go)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Go)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Go)", body: testingBody(lang, "`go test`") },
  ];
}

export const goPack: Pack = { id: "go", detect, rules, promptTemplates };
