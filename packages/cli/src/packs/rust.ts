import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

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

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Rust${framework !== "none" ? ` con ${framework}` : ""} (cargo).`,
    conventions: [
      "Sigue el formato estándar de `rustfmt`; corre `cargo clippy` para detectar problemas idiomáticos.",
      "Ejecuta los tests con `cargo test` antes de terminar una tarea.",
      "Evita `unwrap()`/`expect()` en código de producción salvo que la invariante esté justificada.",
    ],
    architectureNotes: [
      "Mantén los módulos con una responsabilidad clara; usa `mod.rs` o archivos de módulo con nombre explícito según lo que ya use el repo.",
      "Declara toda dependencia nueva en Cargo.toml y mantén Cargo.lock sincronizado.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Rust)",
      body: `Revisa el diff actual buscando bugs, usos innecesarios de \`unwrap()\`/\`clone()\` y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Rust)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable. Respeta el sistema de ownership existente.`,
    },
    {
      id: "testing",
      title: "Testing (Rust)",
      body: `Escribe tests con \`cargo test\` para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const rustPack: Pack = { id: "rust", detect, rules, promptTemplates };
