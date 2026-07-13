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
  const framework = detectNamedSignal(source, FRAMEWORKS);
  const detectedRunner = detectNamedSignal(source, TEST_RUNNERS);
  const testRunner = detectedRunner.value === "none"
    ? { value: "unknown", confidence: "low" as const }
    : detectedRunner;

  const packageManager: DetectionResult["packageManager"] = signals.cmakeLists
    ? { value: "cmake", confidence: "high" }
    : { value: "make", confidence: "high" };

  return { packId: "cpp", language: "C/C++", framework, testRunner, packageManager };
}

const TEXTS: Record<Lang, { style: string; memory: string; arch: string[]; reviewFocus: string }> = {
  es: {
    style: "Sigue el estilo de formato ya usado en el proyecto (revisa si hay un `.clang-format`).",
    memory:
      "Gestiona la memoria con cuidado: prefiere RAII/smart pointers sobre `new`/`delete` manuales cuando el proyecto ya lo haga.",
    arch: [
      "Mantén los headers con guardas de inclusión (`#pragma once` o include guards) consistentes con el resto del proyecto.",
      "Declara toda dependencia nueva en el sistema de build existente (CMakeLists.txt o Makefile).",
    ],
    reviewFocus: "fugas de memoria, punteros colgantes",
  },
  en: {
    style: "Follow the formatting style already used in the project (check for a `.clang-format`).",
    memory:
      "Manage memory carefully: prefer RAII/smart pointers over manual `new`/`delete` when the project already does.",
    arch: [
      "Keep header include guards (`#pragma once` or include guards) consistent with the rest of the project.",
      "Declare every new dependency in the existing build system (CMakeLists.txt or Makefile).",
    ],
    reviewFocus: "memory leaks, dangling pointers",
  },
};

function rules(detection: DetectionResult, lang: Lang): RuleSet {
  const t = TEXTS[lang];
  const framework = detectedName(detection.framework);
  const testCmd = detection.packageManager?.value === "cmake" ? "cmake --build . && ctest" : "make test";
  return {
    summary: summarySentence(lang, "C/C++", framework, detection.packageManager?.value),
    conventions: [t.style, runTestsConvention(lang, testCmd), t.memory],
    architectureNotes: t.arch,
  };
}

function promptTemplates(detection: DetectionResult, lang: Lang): PromptTemplate[] {
  const t = TEXTS[lang];
  const framework = detectedName(detection.framework);
  const runner = detection.testRunner?.value !== "unknown" ? detection.testRunner?.value : undefined;
  return [
    { id: "review", title: "Code Review (C/C++)", body: reviewBody(lang, t.reviewFocus, framework) },
    { id: "refactor", title: "Refactor (C/C++)", body: refactorBody(lang) },
    { id: "testing", title: "Testing (C/C++)", body: testingBody(lang, runner) },
  ];
}

export const cppPack: Pack = { id: "cpp", detect, rules, promptTemplates };
