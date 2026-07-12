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
  type Lang,
} from "../core/i18n.js";
import { canonicalOf } from "../core/canonical-commands.js";
import type { PackContext } from "../core/types.js";

const SPRING_RISK: Record<Lang, string> = {
  es: "Presta especial atención a los límites de transacción (@Transactional), la inyección de dependencias y la separación controller/service/repository.",
  en: "Pay special attention to transaction boundaries (@Transactional), dependency injection and the controller/service/repository separation.",
};

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.pomXml ?? signals.buildGradle;
  if (!source) return null;
  // A Gradle build that applies the Kotlin plugin is a Kotlin project, not Java —
  // defer entirely to the Kotlin pack instead of also reporting a spurious Java match.
  // Modern Gradle projects often declare plugins via version catalogs
  // (`alias(libs.plugins.kotlin.android)`) rather than the literal `kotlin("jvm")` or
  // `org.jetbrains.kotlin` plugin id, so a plain word-boundary check on "kotlin" is
  // more robust than trying to match every DSL style.
  if (
    (signals.buildGradle && /\bkotlin\b/i.test(signals.buildGradle)) ||
    (signals.pomXml && /\bkotlin\b/i.test(signals.pomXml))
  ) return null;

  const framework: DetectionField<string> = /(?:org\.springframework|spring-boot|springframework)/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const packageManager: DetectionField<string> = signals.pomXml
    ? signals.hasFile("mvnw") || signals.hasFile("mvnw.cmd")
      ? { value: "maven wrapper", confidence: "high" }
      : { value: "maven", confidence: "high" }
    : signals.hasFile("gradlew") || signals.hasFile("gradlew.bat")
    ? { value: "gradle wrapper", confidence: "high" }
    : { value: "gradle", confidence: "high" };

  const testRunner: DetectionField<string> = /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return { packId: "java", language: "Java", framework, packageManager, testRunner };
}

const TEXTS: Record<Lang, { naming: string; deps: string; arch: string[]; reviewFocus: string }> = {
  es: {
    naming: "Sigue las convenciones de nombrado estándar de Java (PascalCase para clases, camelCase para métodos).",
    deps: "No añadas dependencias nuevas sin declararlas en el gestor de build existente.",
    arch: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
    reviewFocus: "null-safety",
  },
  en: {
    naming: "Follow standard Java naming conventions (PascalCase for classes, camelCase for methods).",
    deps: "Do not add new dependencies without declaring them in the existing build tool.",
    arch: [
      "Respect the layered separation (controller/service/repository) if the project already uses it.",
      "Prefer dependency injection over manual instantiation when the framework already provides it.",
    ],
    reviewFocus: "null-safety",
  },
};

function rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const wrapperCmd = detection.packageManager?.value === "maven wrapper"
    ? "./mvnw test"
    : detection.packageManager?.value === "maven"
    ? "mvn test"
    : detection.packageManager?.value === "gradle wrapper"
    ? "./gradlew test"
    : "gradle test";
  const testCmd = canonicalOf(ctx, "test", "java")?.command ?? wrapperCmd;
  return {
    summary: summarySentence(lang, "Java", framework, detection.packageManager?.value),
    conventions: [t.naming, runTestsConvention(lang, testCmd), t.deps],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detection.framework?.value !== "none" ? detection.framework?.value : undefined;
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  const test = canonicalOf(ctx, "test", "java");
  const build = canonicalOf(ctx, "build", "java");
  const testDirs = ctx?.facts.testDirs ?? [];
  const es = lang === "es";

  const reviewParts: string[] = [];
  reviewParts.push(
    es
      ? `Revisa el diff actual contra las convenciones Java de este repositorio${framework ? ` (${framework})` : ""}.`
      : `Review the current diff against this repository's Java conventions${framework ? ` (${framework})` : ""}.`
  );
  if (test) {
    reviewParts.push(es ? `Ejecuta \`${test.command}\` antes de dar por buena la revisión.` : `Run \`${test.command}\` before approving the review.`);
  }
  if (build && build.command !== test?.command) {
    reviewParts.push(es ? `CI también ejecuta \`${build.command}\`.` : `CI also runs \`${build.command}\`.`);
  }
  if (framework === "spring") reviewParts.push(SPRING_RISK[lang]);
  reviewParts.push(es ? `Busca también bugs: ${t.reviewFocus}.` : `Also look for bugs: ${t.reviewFocus}.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    reviewParts.push(es ? `Los tests viven en ${dirs}.` : `Tests live under ${dirs}.`);
  }
  reviewParts.push(es ? "Señala solo hallazgos concretos con archivo y línea." : "Report only concrete findings with file and line references.");

  const testingParts: string[] = [testingBody(lang, runner)];
  if (test) testingParts.push(es ? `Verifica la suite con \`${test.command}\` antes de terminar.` : `Verify the suite with \`${test.command}\` before finishing.`);
  if (testDirs.length > 0) {
    const dirs = testDirs.map((d) => `\`${d}\``).join(", ");
    testingParts.push(es ? `Coloca los tests nuevos en ${dirs}.` : `Place new tests under ${dirs}.`);
  }

  return [
    { id: "review", title: "Code Review (Java)", body: ctx ? reviewParts.join(" ") : reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (Java)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (Java)", body: ctx ? testingParts.join(" ") : testingBody(lang, runner) },
  ];
}

export const javaPack: Pack = { id: "java", detect, rules, promptTemplates };
