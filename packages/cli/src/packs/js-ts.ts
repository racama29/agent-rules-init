import type {
  DetectionField,
  DetectionResult,
  Pack,
  PromptTemplate,
  RepoSignals,
  RuleSet,
} from "../core/types.js";

const FRAMEWORKS: Record<string, string> = {
  next: "next",
  "@nestjs/core": "nestjs",
  react: "react",
  vue: "vue",
  "@angular/core": "angular",
  svelte: "svelte",
  fastify: "fastify",
  koa: "koa",
  express: "express",
};

const TEST_RUNNERS: Record<string, string> = {
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
};

const LINTERS: Record<string, string> = {
  eslint: "eslint",
  biome: "biome",
};

function detectFromDeps(
  deps: Record<string, string>,
  table: Record<string, string>
): DetectionField<string> | undefined {
  for (const [depName, label] of Object.entries(table)) {
    if (deps[depName]) return { value: label, confidence: "high" };
  }
  return undefined;
}

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.packageJson) return null;
  const allDeps = { ...signals.packageJson.dependencies, ...signals.packageJson.devDependencies };

  const framework = detectFromDeps(allDeps, FRAMEWORKS) ?? {
    value: "none",
    confidence: "low" as const,
  };
  const testRunner = detectFromDeps(allDeps, TEST_RUNNERS) ?? {
    value: "unknown",
    confidence: "low" as const,
  };
  const linter = detectFromDeps(allDeps, LINTERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.hasFile("pnpm-lock.yaml")
    ? { value: "pnpm", confidence: "high" }
    : signals.hasFile("yarn.lock")
    ? { value: "yarn", confidence: "high" }
    : signals.hasFile("package-lock.json")
    ? { value: "npm", confidence: "high" }
    : { value: "npm", confidence: "low" };

  const usesTypeScript = Boolean(allDeps.typescript) || signals.hasFile("tsconfig.json");
  const moduleFormat = signals.packageJson.moduleType;

  return {
    packId: "js-ts",
    language: usesTypeScript ? "TypeScript" : "JavaScript",
    framework,
    testRunner,
    linter,
    packageManager,
    usesTypeScript,
    moduleFormat,
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  const testRunner = detection.testRunner?.value ?? "unknown";
  const conventions: string[] = [];
  if (detection.usesTypeScript) {
    conventions.push("Usa TypeScript estricto; evita `any` salvo justificación explícita.");
  }
  conventions.push(
    `Ejecuta los tests con ${testRunner === "unknown" ? "el test runner del proyecto" : testRunner} antes de dar por terminada una tarea.`
  );
  conventions.push(
    detection.moduleFormat === "module"
      ? "Sigue el estilo de módulos ES existente (import/export), no mezcles con require()."
      : "Sigue el estilo CommonJS existente (require()/module.exports), no mezcles con import/export."
  );
  return {
    summary: `Proyecto ${detection.usesTypeScript ? "TypeScript" : "JavaScript"}${framework !== "none" ? ` con ${framework}` : ""}.`,
    conventions,
    architectureNotes: [
      "Mantén los componentes/módulos pequeños y con una responsabilidad clara.",
      "Coloca los tests junto al código que prueban o en un directorio `test/` espejo, según lo que ya use el repo.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (JS/TS)",
      body: `Revisa el diff actual buscando bugs de tipado, condiciones de carrera en async/await, y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (JS/TS)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable. Respeta los tipos existentes.`,
    },
    {
      id: "testing",
      title: "Testing (JS/TS)",
      body: `Escribe tests para el código señalado usando ${detection.testRunner?.value !== "unknown" ? `el test runner detectado (${detection.testRunner?.value})` : "el test runner del proyecto"}. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const jsTsPack: Pack = { id: "js-ts", detect, rules, promptTemplates };
