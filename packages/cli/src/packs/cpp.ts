import type { DetectionResult, Pack, PromptTemplate, RepoSignals, RuleSet } from "../core/types.js";

const FRAMEWORKS: [string, string][] = [
  ["find_package(qt", "qt"],
  ["find_package(boost", "boost"],
  ["find_package(sdl2", "sdl2"],
];

const TEST_RUNNERS: [string, string][] = [
  ["gtest", "gtest"],
  ["catch2", "catch2"],
  ["doctest", "doctest"],
];

const CPP_COMPILER_TOKENS = ["$(cc)", "$(cxx)", "gcc", "g++", "clang"];

// Source-file extensions need a stricter boundary check than a plain substring:
// Go module paths hosted on the ".cc" ccTLD (e.g. "mvdan.cc/gofumpt") also contain
// ".cc", but it's followed by "/", never by whitespace/quote/paren/end-of-line the
// way a real compiled source file reference in a Makefile would be.
const CPP_SOURCE_EXTENSION = /\.(cpp|cxx|cc)(?=[\s:"')]|$)/im;

function looksLikeCppMakefile(makefile: string): boolean {
  const lower = makefile.toLowerCase();
  return CPP_COMPILER_TOKENS.some((needle) => lower.includes(needle)) || CPP_SOURCE_EXTENSION.test(makefile) || /\.o:/.test(makefile);
}

function detect(signals: RepoSignals): DetectionResult | null {
  // A bare Makefile isn't C/C++-specific — plenty of Python/JS/etc. projects ship
  // one as a generic task runner (or a Sphinx docs Makefile, like Flask's docs/Makefile).
  // Only trust it once it actually references a C/C++ compiler or source file.
  const makefileSource =
    signals.makefile && looksLikeCppMakefile(signals.makefile) ? signals.makefile : undefined;
  const source = signals.cmakeLists ?? makefileSource;
  if (!source) return null;
  const lower = source.toLowerCase();

  let framework: DetectionResult["framework"] = { value: "none", confidence: "low" };
  for (const [needle, label] of FRAMEWORKS) {
    if (lower.includes(needle)) {
      framework = { value: label, confidence: "high" };
      break;
    }
  }

  let testRunner: DetectionResult["testRunner"] = { value: "unknown", confidence: "low" };
  for (const [needle, label] of TEST_RUNNERS) {
    if (lower.includes(needle)) {
      testRunner = { value: label, confidence: "high" };
      break;
    }
  }

  const packageManager: DetectionResult["packageManager"] = signals.cmakeLists
    ? { value: "cmake", confidence: "high" }
    : { value: "make", confidence: "high" };

  return { packId: "cpp", language: "C/C++", framework, testRunner, packageManager };
}

function rules(detection: DetectionResult): RuleSet {
  const framework = detection.framework?.value ?? "none";
  return {
    summary: `Proyecto C/C++${framework !== "none" ? ` con ${framework}` : ""} (${detection.packageManager?.value}).`,
    conventions: [
      "Sigue el estilo de formato ya usado en el proyecto (revisa si hay un `.clang-format`).",
      `Compila y ejecuta los tests con ${detection.packageManager?.value === "cmake" ? "cmake --build . && ctest" : "make test"} antes de terminar una tarea.`,
      "Gestiona la memoria con cuidado: prefiere RAII/smart pointers sobre `new`/`delete` manuales cuando el proyecto ya lo haga.",
    ],
    architectureNotes: [
      "Mantén los headers con guardas de inclusión (`#pragma once` o include guards) consistentes con el resto del proyecto.",
      "Declara toda dependencia nueva en el sistema de build existente (CMakeLists.txt o Makefile).",
    ],
  };
}

function promptTemplates(detection: DetectionResult): PromptTemplate[] {
  const framework = detection.framework?.value ?? "el framework del proyecto";
  return [
    {
      id: "review",
      title: "Code Review (C/C++)",
      body: `Revisa el diff actual buscando fugas de memoria, punteros colgantes y desviaciones de las convenciones de ${framework}. Señala solo problemas concretos con línea de archivo.`,
    },
    {
      id: "refactor",
      title: "Refactor (C/C++)",
      body: `Propón refactors que reduzcan duplicación y mejoren la legibilidad sin cambiar comportamiento observable.`,
    },
    {
      id: "testing",
      title: "Testing (C/C++)",
      body: `Escribe tests con ${detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : "el framework de tests del proyecto"} para el código señalado. Cubre el camino feliz y al menos un caso límite.`,
    },
  ];
}

export const cppPack: Pack = { id: "cpp", detect, rules, promptTemplates };
