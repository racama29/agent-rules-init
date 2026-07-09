import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

const FRAMEWORKS: [string, string][] = [
  ["gin-gonic/gin", "gin"],
  ["labstack/echo", "echo"],
  ["gofiber/fiber", "fiber"],
  ["go-chi/chi", "chi"],
];

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.goMod;
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
    packId: "go",
    language: "Go",
    framework,
    testRunner: { value: "go test", confidence: "high" },
    packageManager: { value: "go modules", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Go${framework !== "none" ? ` con ${framework}` : ""} (go modules).`,
    conventions: [
      "Sigue el formato estándar de `gofmt`; no introduzcas estilos alternativos.",
      "Ejecuta los tests con `go test ./...` antes de terminar una tarea.",
      "Maneja los errores explícitamente (`if err != nil`); no los ignores en silencio.",
    ],
    architectureNotes: [
      "Mantén los paquetes con una responsabilidad clara; evita paquetes `util` genéricos.",
      "Declara toda dependencia nueva vía `go get` y mantén `go.mod`/`go.sum` sincronizados.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Go)",
      body: `Revisa el diff actual buscando bugs, manejo de errores omitido y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Go)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Go)",
      body: `Escribe tests con \`go test\` para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const goPack: Pack = { id: "go", detect, rules, promptTemplates };
