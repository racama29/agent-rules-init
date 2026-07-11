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

function detectPackageManagerFromCi(signals: RepoSignals): DetectionField<string> | undefined {
  const managers = new Set<string>();
  for (const workflow of signals.githubWorkflows ?? []) {
    for (const rawLine of workflow.content.split(/\r?\n/)) {
      const command = rawLine.trim().replace(/^(?:-\s*)?run:\s*(?:[|>]\s*)?/, "").trim();
      const manager = /^(npm|pnpm|yarn|bun)\b/.exec(command)?.[1];
      if (manager) managers.add(manager);
    }
  }
  return managers.size === 1 ? { value: [...managers][0], confidence: "high" } : undefined;
}

function detect(signals: RepoSignals): DetectionResult | null {
  if (!signals.packageJson) return null;
  const allDeps = { ...signals.packageJson.dependencies, ...signals.packageJson.devDependencies };
  const hasAnyFileNamed = (name: string) =>
    signals.files.some((file) => file.split(/[\\/]/).pop() === name);

  const isFrameworkSource = Boolean(
    signals.packageJson.name && Object.prototype.hasOwnProperty.call(FRAMEWORKS, signals.packageJson.name)
  );
  const framework = detectFromDeps(allDeps, FRAMEWORKS) ?? {
    value: "none",
    confidence: isFrameworkSource ? "high" as const : "low" as const,
  };
  const testRunner = detectFromDeps(allDeps, TEST_RUNNERS) ?? {
    value: "unknown",
    confidence: "low" as const,
  };
  const linter = detectFromDeps(allDeps, LINTERS) ?? { value: "unknown", confidence: "low" as const };
  const packageManager: DetectionField<string> = signals.packageJson.packageManager
    ? { value: signals.packageJson.packageManager, confidence: "high" }
    : signals.hasFile("bun.lock") || signals.hasFile("bun.lockb")
    ? { value: "bun", confidence: "high" }
    : signals.hasFile("pnpm-lock.yaml")
    ? { value: "pnpm", confidence: "high" }
    : signals.hasFile("yarn.lock")
    ? { value: "yarn", confidence: "high" }
    : signals.hasFile("package-lock.json") || signals.hasFile("npm-shrinkwrap.json")
    ? { value: "npm", confidence: "high" }
    : hasAnyFileNamed("bun.lock") || hasAnyFileNamed("bun.lockb")
    ? { value: "bun", confidence: "high" }
    : hasAnyFileNamed("pnpm-lock.yaml")
    ? { value: "pnpm", confidence: "high" }
    : hasAnyFileNamed("yarn.lock")
    ? { value: "yarn", confidence: "high" }
    : hasAnyFileNamed("package-lock.json") || hasAnyFileNamed("npm-shrinkwrap.json")
    ? { value: "npm", confidence: "high" }
    : detectPackageManagerFromCi(signals) ?? { value: "npm", confidence: "low" };

  const usesTypeScript =
    Boolean(allDeps.typescript) || signals.hasFile("tsconfig.json") || hasAnyFileNamed("tsconfig.json");
  const moduleTypes = new Set(
    (signals.packageJsons?.length ? signals.packageJsons : [signals.packageJson]).map((p) => p.moduleType)
  );
  // Mixed ESM/CommonJS workspaces should not receive a repo-wide rule that is wrong
  // for half of the packages.
  const moduleFormat = moduleTypes.size === 1 ? [...moduleTypes][0] : undefined;

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

const TEXTS: Record<
  Lang,
  { tsStrict: string; esModules: string; commonJs: string; arch: string[]; reviewFocus: string; refactorExtra: string }
> = {
  es: {
    tsStrict: "Usa TypeScript estricto; evita `any` salvo justificación explícita.",
    esModules: "Sigue el estilo de módulos ES existente (import/export), no mezcles con require().",
    commonJs: "Sigue el estilo CommonJS existente (require()/module.exports), no mezcles con import/export.",
    arch: [
      "Mantén los componentes/módulos pequeños y con una responsabilidad clara.",
      "Coloca los tests junto al código que prueban o en un directorio `test/` espejo, según lo que ya use el repo.",
    ],
    reviewFocus: "errores de tipado, condiciones de carrera en async/await",
    refactorExtra: "Respeta los tipos existentes.",
  },
  en: {
    tsStrict: "Use strict TypeScript; avoid `any` unless explicitly justified.",
    esModules: "Follow the existing ES modules style (import/export); do not mix in require().",
    commonJs: "Follow the existing CommonJS style (require()/module.exports); do not mix in import/export.",
    arch: [
      "Keep components/modules small and single-purpose.",
      "Place tests next to the code they cover or in a mirrored `test/` directory, following what the repo already uses.",
    ],
    reviewFocus: "typing errors, async/await race conditions",
    refactorExtra: "Respect the existing types.",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const conventions: string[] = [];
  if (detection.usesTypeScript) conventions.push(t.tsStrict);
  conventions.push(runTestsConvention(lang, runner ?? unknownRunnerLabel(lang)));
  if (detection.moduleFormat) {
    conventions.push(detection.moduleFormat === "module" ? t.esModules : t.commonJs);
  }
  return {
    summary: summarySentence(lang, detection.usesTypeScript ? "TypeScript" : "JavaScript", framework),
    conventions,
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework!.value : unknownFrameworkLabel(lang);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner!.value : unknownRunnerLabel(lang);
  return [
    { id: "review", title: "Code Review (JS/TS)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (JS/TS)", body: refactorBody(lang, t.refactorExtra) },
    { id: "testing", title: "Testing (JS/TS)", body: testingBody(lang, runner) },
  ];
}

export const jsTsPack: Pack = { id: "js-ts", detect, rules, promptTemplates };
