import type {
  CanonicalCommand,
  DetectionField,
  DetectionResult,
  Pack,
  PackContext,
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
  { tsStrict: string; esModules: string; commonJs: string; arch: string[]; reviewFocusTs: string; reviewFocusJs: string; refactorExtra: string }
> = {
  es: {
    tsStrict: "Usa TypeScript estricto; evita `any` salvo justificación explícita.",
    esModules: "Sigue el estilo de módulos ES existente (import/export), no mezcles con require().",
    commonJs: "Sigue el estilo CommonJS existente (require()/module.exports), no mezcles con import/export.",
    arch: [
      "Mantén los componentes/módulos pequeños y con una responsabilidad clara.",
      "Coloca los tests junto al código que prueban o en un directorio `test/` espejo, según lo que ya use el repo.",
    ],
    reviewFocusTs: "errores de tipado, condiciones de carrera en async/await",
    reviewFocusJs: "condiciones de carrera en async/await",
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
    reviewFocusTs: "typing errors, async/await race conditions",
    reviewFocusJs: "async/await race conditions",
    refactorExtra: "Respect the existing types.",
  },
};

function canonicalOf(ctx: PackContext | undefined, kind: CanonicalCommand["kind"]): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}

const FRAMEWORK_RISKS: Record<string, Record<Lang, string>> = {
  express: {
    es: "Presta especial atención al flujo de middleware, la propagación de errores con `next(err)` y el ciclo de vida de la respuesta.",
    en: "Pay special attention to middleware control flow, error propagation through `next(err)` and response lifecycle handling.",
  },
  react: {
    es: "Presta especial atención a las dependencias de hooks (`useEffect`), renders innecesarios y estado derivado.",
    en: "Pay special attention to hook dependencies (`useEffect`), unnecessary re-renders and derived state.",
  },
  next: {
    es: "Presta especial atención a la frontera servidor/cliente (`use client`), el data fetching y el caché de rutas.",
    en: "Pay special attention to the server/client boundary (`use client`), data fetching and route caching.",
  },
  nestjs: {
    es: "Presta especial atención a los scopes de providers, la inyección de dependencias y los pipes de validación.",
    en: "Pay special attention to provider scopes, dependency injection and validation pipes.",
  },
  fastify: {
    es: "Presta especial atención al ciclo de vida de plugins, la encapsulación y los schemas de validación.",
    en: "Pay special attention to plugin lifecycle, encapsulation and validation schemas.",
  },
};

function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const testCmd = canonicalOf(ctx, "test")?.command ?? runner;
  const conventions: string[] = [];
  if (detection.usesTypeScript) conventions.push(t.tsStrict);
  conventions.push(runTestsConvention(lang, testCmd));
  if (detection.moduleFormat) {
    conventions.push(detection.moduleFormat === "module" ? t.esModules : t.commonJs);
  }
  return {
    summary: summarySentence(lang, detection.usesTypeScript ? "TypeScript" : "JavaScript", framework),
    conventions,
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const focus = detection.usesTypeScript ? t.reviewFocusTs : t.reviewFocusJs;
  const test = canonicalOf(ctx, "test");
  const lint = canonicalOf(ctx, "lint");
  const testDirs = ctx?.facts.testDirs ?? [];

  const es = lang === "es";
  const reviewParts: string[] = [];
  const moduleLabel = detection.moduleFormat === "commonjs" ? "CommonJS" : detection.moduleFormat === "module" ? "ESM" : undefined;
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones${moduleLabel ? ` ${moduleLabel}` : ""} de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's${moduleLabel ? ` ${moduleLabel}` : ""} conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test || lint) {
    const commands = [test, lint].filter((c): c is CanonicalCommand => c !== undefined);
    const list = commands.map((c) => `\`${c.command}\``).join(es ? " y " : " and ");
    reviewParts.push(es ? `Ejecuta ${list} antes de dar por buena la revisión.` : `Run ${list} before approving the review.`);
  }
  const risk = framework ? FRAMEWORK_RISKS[framework]?.[lang] : undefined;
  if (risk) reviewParts.push(risk);
  reviewParts.push(es ? `Busca también bugs: ${focus}.` : `Also look for bugs: ${focus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(
    es
      ? "Señala solo hallazgos concretos con archivo y línea."
      : "Report only concrete findings with file and line references."
  );

  const testingParts: string[] = [];
  testingParts.push(testingBody(lang, runner));
  if (test) {
    testingParts.push(
      es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`
    );
  }
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    {
      id: "review",
      title: "Code Review (JS/TS)",
      body: ctx ? reviewParts.join(" ") : reviewBody(lang, focus, framework),
    },
    { id: "refactor", title: "Refactor (JS/TS)", body: refactorBody(lang, detection.usesTypeScript ? t.refactorExtra : undefined) },
    { id: "testing", title: "Testing (JS/TS)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}

export const jsTsPack: Pack = { id: "js-ts", detect, rules, promptTemplates };
