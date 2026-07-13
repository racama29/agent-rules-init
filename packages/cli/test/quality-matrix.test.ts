import { describe, expect, it } from "vitest";
import type { RepoSignals } from "../src/core/types.js";
import { findPack } from "../src/packs/index.js";

interface Scenario {
  name: string;
  pack: string;
  signals: Partial<RepoSignals>;
  framework: string;
}

const manifest = (dependencies: Record<string, string> = {}): RepoSignals["packageJson"] => ({
  dependencies, devDependencies: {}, scripts: {}, moduleType: "module",
});

const SCENARIOS: readonly Scenario[] = [
  { name: "js-react", pack: "js-ts", signals: { packageJson: manifest({ react: "18" }) }, framework: "react" },
  { name: "js-plain", pack: "js-ts", signals: { packageJson: manifest() }, framework: "none" },
  { name: "python-fastapi", pack: "python", signals: { pyprojectToml: 'dependencies = ["fastapi"]' }, framework: "fastapi" },
  { name: "python-plain", pack: "python", signals: { requirementsTxt: "requests==2" }, framework: "none" },
  { name: "java-spring", pack: "java", signals: { pomXml: "org.springframework.boot spring-boot" }, framework: "spring" },
  { name: "java-plain", pack: "java", signals: { pomXml: "<artifactId>plain</artifactId>" }, framework: "none" },
  { name: "php-laravel", pack: "php", signals: { composerJson: { require: { "laravel/framework": "11" }, requireDev: {} } }, framework: "laravel" },
  { name: "php-plain", pack: "php", signals: { composerJson: { require: {}, requireDev: {} } }, framework: "none" },
  { name: "ruby-rails", pack: "ruby", signals: { gemfile: 'gem "rails"' }, framework: "rails" },
  { name: "ruby-plain", pack: "ruby", signals: { gemfile: 'gem "rake"' }, framework: "none" },
  { name: "go-gin", pack: "go", signals: { goMod: "module demo\nrequire github.com/gin-gonic/gin v1.10.0" }, framework: "gin" },
  { name: "go-plain", pack: "go", signals: { goMod: "module demo\ngo 1.22" }, framework: "none" },
  { name: "rust-axum", pack: "rust", signals: { cargoToml: '[dependencies]\naxum = "0.7"' }, framework: "axum" },
  { name: "rust-plain", pack: "rust", signals: { cargoToml: "[package]\nname='demo'" }, framework: "none" },
  { name: "dotnet-web", pack: "csharp", signals: { csproj: "Microsoft.AspNetCore.App" }, framework: "aspnet-core" },
  { name: "dotnet-plain", pack: "csharp", signals: { csproj: "<Project></Project>" }, framework: "none" },
  { name: "kotlin-ktor", pack: "kotlin", signals: { buildGradle: 'plugins { kotlin("jvm") } implementation("io.ktor:ktor-server-core")' }, framework: "ktor" },
  { name: "kotlin-plain", pack: "kotlin", signals: { buildGradle: 'plugins { kotlin("jvm") }' }, framework: "none" },
  { name: "swift-vapor", pack: "swift", signals: { packageSwift: "dependency url: vapor/vapor", files: ["Sources/App.swift"] }, framework: "vapor" },
  { name: "swift-plain", pack: "swift", signals: { packageSwift: "// swift-tools-version: 5.9", files: ["Sources/App.swift"] }, framework: "none" },
  { name: "dart-flutter", pack: "dart", signals: { pubspecYaml: "dependencies:\n  flutter:\n    sdk: flutter" }, framework: "flutter" },
  { name: "dart-plain", pack: "dart", signals: { pubspecYaml: "name: demo" }, framework: "none" },
  { name: "cpp-qt", pack: "cpp", signals: { cmakeLists: "find_package(Qt6 REQUIRED)" }, framework: "qt" },
  { name: "cpp-plain", pack: "cpp", signals: { cmakeLists: "project(demo)" }, framework: "none" },
  { name: "elixir-phoenix", pack: "elixir", signals: { mixExs: "{:phoenix, \"~> 1.7\"}" }, framework: "phoenix" },
  { name: "elixir-plain", pack: "elixir", signals: { mixExs: "defmodule Demo.MixProject" }, framework: "none" },
  { name: "scala-play", pack: "scala", signals: { buildSbt: 'libraryDependencies += "org.playframework"' }, framework: "play" },
  { name: "scala-plain", pack: "scala", signals: { buildSbt: 'scalaVersion := "3.5.0"' }, framework: "none" },
  { name: "r-shiny", pack: "r", signals: { rDescription: "Imports: shiny" }, framework: "shiny" },
  { name: "r-plain", pack: "r", signals: { rDescription: "Package: demo" }, framework: "none" },
];

function signals(overrides: Partial<RepoSignals>): RepoSignals {
  const files = overrides.files ?? [];
  return {
    rootPath: "/quality-matrix", files,
    hasFile: (file) => files.includes(file),
    hasDir: () => false,
    ...overrides,
  };
}

describe("30-scenario stack quality matrix", () => {
  expect(SCENARIOS).toHaveLength(30);
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const detection = (await findPack(scenario.pack)).detect(signals(scenario.signals));
      expect(detection, `${scenario.name} should detect its language pack`).not.toBeNull();
      expect(detection?.framework?.value).toBe(scenario.framework);
      expect(detection?.framework?.confidence).toBe(scenario.framework === "none" ? "low" : "high");
    });
  }
});
