import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

function detect(signals: RepoSignals): DetectionResult | null {
  const source = signals.buildGradle;
  if (!source) return null;
  // Modern Gradle projects often declare the Kotlin plugin via a version catalog alias
  // (`alias(libs.plugins.kotlin.android)`) rather than the literal `kotlin("jvm")` or
  // `org.jetbrains.kotlin` plugin id, so a plain word-boundary check is more robust.
  if (!/\bkotlin\b/i.test(source)) return null;

  const framework: DetectionResult["framework"] = /ktor/i.test(source)
    ? { value: "ktor", confidence: "high" }
    : /com\.android\.application|com\.android\.library/i.test(source)
    ? { value: "android", confidence: "high" }
    : /spring/i.test(source)
    ? { value: "spring", confidence: "high" }
    : { value: "none", confidence: "low" };

  const testRunner: DetectionResult["testRunner"] = /kotlin\.test|kotest/i.test(source)
    ? { value: "kotest", confidence: "high" }
    : /junit/i.test(source)
    ? { value: "junit", confidence: "high" }
    : { value: "unknown", confidence: "low" };

  return {
    packId: "kotlin",
    language: "Kotlin",
    framework,
    testRunner,
    packageManager: { value: "gradle", confidence: "high" },
  };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto Kotlin${framework !== "none" ? ` con ${framework}` : ""} (gradle).`,
    conventions: [
      "Sigue las convenciones de estilo oficiales de Kotlin (kotlinlang.org/docs/coding-conventions.html).",
      "Ejecuta los tests con `gradle test` antes de terminar una tarea.",
      "Prefiere tipos no-nulos y `val` sobre `var` salvo que la mutabilidad sea necesaria.",
    ],
    architectureNotes: [
      "Respeta la separación en capas (controller/service/repository) si el proyecto ya la usa.",
      "Prefiere inyección de dependencias sobre instanciación manual cuando el framework ya la ofrezca.",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (Kotlin)",
      body: `Revisa el diff actual buscando bugs, uso innecesario de \`!!\` y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (Kotlin)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (Kotlin)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el test runner del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const kotlinPack: Pack = { id: "kotlin", detect, rules, promptTemplates };
