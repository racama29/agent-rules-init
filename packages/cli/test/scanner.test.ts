import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo } from "../src/core/scanner.js";

const fixturesRoot = path.resolve(__dirname, "../../../fixtures");

describe("scanRepo", () => {
  it("reads package.json dependencies for a JS/TS repo", () => {
    const signals = scanRepo(path.join(fixturesRoot, "node-react-vitest"));
    expect(signals.packageJson?.dependencies.react).toBe("^18.3.0");
    expect(signals.packageJson?.devDependencies.vitest).toBe("^2.1.0");
  });

  it("reads pyproject.toml raw content for a Python repo", () => {
    const signals = scanRepo(path.join(fixturesRoot, "python-fastapi"));
    expect(signals.pyprojectToml).toContain("fastapi");
  });

  it("hasFile and hasDir report presence correctly", () => {
    const signals = scanRepo(path.join(fixturesRoot, "node-react-vitest"));
    expect(signals.hasFile("package.json")).toBe(true);
    expect(signals.hasFile("does-not-exist.json")).toBe(false);
  });

  it("finds nested manifests in a monorepo (requirements.txt under backend/)", () => {
    const signals = scanRepo(path.join(fixturesRoot, "monorepo-js-python"));
    expect(signals.packageJson?.dependencies.vue).toBe("^3.4.0");
    expect(signals.requirementsTxt).toContain("fastapi");
  });

  describe("with a nested package.json that alphabetically precedes the root one", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-"));
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "root-project", dependencies: {}, devDependencies: {}, scripts: {} })
      );
      fs.mkdirSync(path.join(tmpDir, "apps", "nested"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "apps", "nested", "package.json"),
        JSON.stringify({ name: "nested-project", dependencies: {}, devDependencies: {}, scripts: {} })
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("prefers the root-level package.json over a nested one", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.packageJson?.name).toBe("root-project");
    });
  });

  describe("with a root environment.yml and an unrelated nested pyproject.toml", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-conda-"));
      fs.writeFileSync(
        path.join(tmpDir, "environment.yml"),
        "name: my_env\ndependencies:\n  - pip:\n    - flask"
      );
      fs.mkdirSync(path.join(tmpDir, "vendored-data"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "vendored-data", "pyproject.toml"),
        '[project]\nname = "vendored-data"\ndependencies = []'
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("prefers the root-level environment.yml over a nested unrelated pyproject.toml", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.environmentYml).toContain("flask");
      expect(signals.pyprojectToml).toBeUndefined();
    });
  });

  describe("with a multi-project .NET solution", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-dotnet-"));
      fs.mkdirSync(path.join(tmpDir, "src", "ApplicationCore"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src", "ApplicationCore", "ApplicationCore.csproj"),
        `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Ardalis.GuardClauses" /></ItemGroup></Project>`
      );
      fs.mkdirSync(path.join(tmpDir, "src", "Web"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src", "Web", "Web.csproj"),
        `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>`
      );
      fs.mkdirSync(path.join(tmpDir, "tests", "UnitTests"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "tests", "UnitTests", "UnitTests.csproj"),
        `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>`
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("aggregates every .csproj in the solution instead of picking just one arbitrarily", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.csproj).toContain("Microsoft.AspNetCore.App");
      expect(signals.csproj).toContain("xunit");
    });
  });

  describe("with a multi-module Gradle project (Kotlin DSL)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-gradle-"));
      fs.mkdirSync(path.join(tmpDir, "android"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "android", "build.gradle.kts"),
        `plugins {\n    alias(libs.plugins.kotlin.android) apply false\n}\n`
      );
      fs.mkdirSync(path.join(tmpDir, "ktor"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "ktor", "build.gradle.kts"),
        `dependencies {\n    implementation("io.ktor:ktor-server-core:2.3.0")\n}\n`
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("aggregates every build.gradle.kts in the project instead of picking just one arbitrarily", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.buildGradle).toContain("kotlin.android");
      expect(signals.buildGradle).toContain("ktor-server-core");
    });
  });

  describe("with a Melos/pub workspace (root pubspec.yaml has no flutter dependency)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-melos-"));
      fs.writeFileSync(
        path.join(tmpDir, "pubspec.yaml"),
        "name: workspace\n\ndev_dependencies:\n  melos: ^6.0.0\n"
      );
      fs.mkdirSync(path.join(tmpDir, "packages", "battery_plus"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "packages", "battery_plus", "pubspec.yaml"),
        "name: battery_plus\n\ndependencies:\n  flutter:\n    sdk: flutter\n\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n"
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("aggregates every pubspec.yaml instead of only the workspace root one", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.pubspecYaml).toContain("flutter_test");
    });
  });

  describe("with a C++ library whose only requirements.txt is docs tooling (e.g. nlohmann/json's docs/mkdocs)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-docs-py-"));
      fs.writeFileSync(path.join(tmpDir, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\nproject(app)\n");
      fs.mkdirSync(path.join(tmpDir, "docs", "mkdocs"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "docs", "mkdocs", "requirements.txt"), "mkdocs\nmkdocs-material\n");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not treat a docs-tooling requirements.txt as the project's Python manifest", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.requirementsTxt).toBeUndefined();
    });
  });
});
