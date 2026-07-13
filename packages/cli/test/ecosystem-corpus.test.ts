import { describe, expect, it } from "vitest";
import type { RepoSignals } from "../src/core/types.js";
import { findPack } from "../src/packs/index.js";

interface StackCorpus {
  pack: string;
  positiveSource: string;
  neutralSource: string;
  positive: Partial<RepoSignals>;
  neutral: Partial<RepoSignals>;
  framework: string;
}

const manifest = (dependencies: Record<string, string> = {}): RepoSignals["packageJson"] => ({
  dependencies, devDependencies: {}, scripts: {}, moduleType: "module",
});

// Manifest signatures are minimized from the named public projects so PR validation
// stays offline and deterministic. Full-repository, pinned-commit validation is a
// separate release gate documented in docs/corpus-methodology.md.
const STACKS: readonly StackCorpus[] = [
  { pack: "js-ts", positiveSource: "vercel/next.js", neutralSource: "lodash/lodash", positive: { packageJson: manifest({ next: "15", react: "19" }) }, neutral: { packageJson: manifest() }, framework: "next" },
  { pack: "python", positiveSource: "pallets/flask", neutralSource: "psf/requests", positive: { pyprojectToml: 'dependencies = ["flask"]' }, neutral: { pyprojectToml: 'dependencies = ["requests"]' }, framework: "flask" },
  { pack: "java", positiveSource: "spring-projects/spring-petclinic", neutralSource: "junit-team/junit5", positive: { pomXml: "org.springframework.boot spring-boot" }, neutral: { pomXml: "org.junit.jupiter" }, framework: "spring" },
  { pack: "php", positiveSource: "laravel/framework", neutralSource: "composer/composer", positive: { composerJson: { require: { "laravel/framework": "12" }, requireDev: {} } }, neutral: { composerJson: { require: {}, requireDev: {} } }, framework: "laravel" },
  { pack: "ruby", positiveSource: "rails/rails", neutralSource: "ruby/rake", positive: { gemfile: 'gem "rails"' }, neutral: { gemfile: 'gem "rake"' }, framework: "rails" },
  { pack: "go", positiveSource: "gin-gonic/gin", neutralSource: "golang/example", positive: { goMod: "module example/app\nrequire github.com/gin-gonic/gin v1.10.0" }, neutral: { goMod: "module example/app\ngo 1.23" }, framework: "gin" },
  { pack: "rust", positiveSource: "tokio-rs/axum", neutralSource: "BurntSushi/ripgrep", positive: { cargoToml: '[dependencies]\naxum = "0.8"' }, neutral: { cargoToml: '[package]\nname = "ripgrep"' }, framework: "axum" },
  { pack: "csharp", positiveSource: "dotnet/aspnetcore", neutralSource: "dotnet/runtime", positive: { csproj: "Microsoft.AspNetCore.App" }, neutral: { csproj: '<Project Sdk="Microsoft.NET.Sdk" />' }, framework: "aspnet-core" },
  { pack: "kotlin", positiveSource: "ktorio/ktor", neutralSource: "JetBrains/kotlin", positive: { buildGradle: 'plugins { kotlin("jvm") } implementation("io.ktor:ktor-server-core")' }, neutral: { buildGradle: 'plugins { kotlin("jvm") }' }, framework: "ktor" },
  { pack: "swift", positiveSource: "vapor/vapor", neutralSource: "apple/swift-argument-parser", positive: { packageSwift: "dependency url: vapor/vapor", files: ["Sources/App.swift"] }, neutral: { packageSwift: "// swift-tools-version: 5.9", files: ["Sources/App.swift"] }, framework: "vapor" },
  { pack: "dart", positiveSource: "flutter/flutter", neutralSource: "dart-lang/http", positive: { pubspecYaml: "dependencies:\n  flutter:\n    sdk: flutter" }, neutral: { pubspecYaml: "name: http" }, framework: "flutter" },
  { pack: "cpp", positiveSource: "qt/qtbase", neutralSource: "fmtlib/fmt", positive: { cmakeLists: "find_package(Qt6 REQUIRED)" }, neutral: { cmakeLists: "project(fmt)" }, framework: "qt" },
  { pack: "elixir", positiveSource: "phoenixframework/phoenix", neutralSource: "elixir-lang/elixir", positive: { mixExs: '{:phoenix, "~> 1.7"}' }, neutral: { mixExs: "defmodule Elixir.MixProject" }, framework: "phoenix" },
  { pack: "scala", positiveSource: "playframework/playframework", neutralSource: "scala/scala3", positive: { buildSbt: 'libraryDependencies += "org.playframework"' }, neutral: { buildSbt: 'scalaVersion := "3.5.0"' }, framework: "play" },
  { pack: "r", positiveSource: "rstudio/shiny", neutralSource: "r-lib/cli", positive: { rDescription: "Imports: shiny" }, neutral: { rDescription: "Package: cli" }, framework: "shiny" },
];

function signals(overrides: Partial<RepoSignals>): RepoSignals {
  const files = overrides.files ?? [];
  return {
    rootPath: "/ecosystem-corpus", files,
    hasFile: (file) => files.includes(file),
    hasDir: () => false,
    ...overrides,
  };
}

describe("60-case ecosystem corpus", () => {
  expect(STACKS).toHaveLength(15);
  for (const scenario of STACKS) {
    it(`${scenario.pack}: detects the framework signature from ${scenario.positiveSource}`, async () => {
      const result = (await findPack(scenario.pack)).detect(signals(scenario.positive));
      expect(result?.framework).toEqual({ value: scenario.framework, confidence: "high" });
    });

    it(`${scenario.pack}: detects a neutral project from ${scenario.neutralSource} without inventing a framework`, async () => {
      const result = (await findPack(scenario.pack)).detect(signals(scenario.neutral));
      expect(result?.framework).toEqual({ value: "none", confidence: "low" });
    });

    it(`${scenario.pack}: ignores its framework token in an unrelated README`, async () => {
      const result = (await findPack(scenario.pack)).detect(signals({
        files: ["README.md"], guidanceFiles: [{ path: "README.md", content: scenario.framework }],
      }));
      expect(result).toBeNull();
    });

    it(`${scenario.pack}: ignores source-like noise without its defining manifest`, async () => {
      const result = (await findPack(scenario.pack)).detect(signals({ files: ["docs/example.txt", "src/noise.txt"] }));
      expect(result).toBeNull();
    });
  }
});
