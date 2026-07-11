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

  it("aggregates dependencies from nested npm workspace manifests", () => {
    const signals = scanRepo(path.resolve(fixturesRoot, ".."));
    expect(signals.packageJson?.devDependencies.vitest).toBe("^2.1.0");
    expect(signals.packageJsons?.map((p) => p.path)).toContain("packages/cli/package.json");
  });

  it("assigns each package the nearest package-manager lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-managers-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
      fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      fs.mkdirSync(path.join(tmpDir, "packages", "web"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "packages", "web", "package.json"),
        JSON.stringify({ scripts: { build: "vite build" } })
      );
      fs.mkdirSync(path.join(tmpDir, "standalone"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "standalone", "package.json"),
        JSON.stringify({ scripts: { test: "bun test" } })
      );
      fs.writeFileSync(path.join(tmpDir, "standalone", "bun.lock"), "");

      const manifests = scanRepo(tmpDir).packageJsons!;
      expect(manifests.find((item) => item.path === "package.json")?.packageManager).toBe("pnpm");
      expect(manifests.find((item) => item.path === "packages/web/package.json")?.packageManager).toBe("pnpm");
      expect(manifests.find((item) => item.path === "standalone/package.json")?.packageManager).toBe("bun");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("honors the packageManager field even without a lockfile", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-corepack-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ packageManager: "yarn@4.9.2" }));
      const signals = scanRepo(tmpDir);
      expect(signals.packageJson?.packageManager).toBe("yarn");
      expect(signals.packageJsons?.[0].packageManager).toBe("yarn");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not descend into common generated dependency and build directories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-ignored-"));
    try {
      for (const dir of ["target", "vendor", ".next", "coverage", ".gradle", ".dart_tool"]) {
        fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, dir, "noise.txt"), "generated");
      }
      expect(scanRepo(tmpDir).files).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ignores its own generated files so repeated scans are stable", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-own-output-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".claude", "commands"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "generated");
      fs.writeFileSync(path.join(tmpDir, ".claude", "commands", "review.generated.md"), "generated");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "real");
      expect(scanRepo(tmpDir).files).toEqual(["README.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("with CI workflows, tox.ini and composer scripts", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-facts-"));
      fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".github", "workflows", "ci.yml"),
        "jobs:\n  test:\n    steps:\n      - run: npm test\n"
      );
      fs.writeFileSync(path.join(tmpDir, "tox.ini"), "[tox]\nenvlist = py311\n");
      fs.writeFileSync(path.join(tmpDir, "composer.json"), JSON.stringify({ require: {}, scripts: { test: "phpunit" } }));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("captures workflow files with normalized paths and raw content", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.githubWorkflows).toHaveLength(1);
      expect(signals.githubWorkflows?.[0].path).toBe(".github/workflows/ci.yml");
      expect(signals.githubWorkflows?.[0].content).toContain("npm test");
    });

    it("captures tox.ini raw content", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.toxIni).toContain("envlist");
    });

    it("captures composer.json scripts", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.composerJson?.scripts).toEqual({ test: "phpunit" });
    });
  });

  describe("with a Makefile that only exists under a docs/tooling directory", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-makefile-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("ignores a docs-only Makefile (e.g. Sphinx's docs/Makefile in Flask)", () => {
      fs.mkdirSync(path.join(tmpDir, "docs"));
      fs.writeFileSync(path.join(tmpDir, "docs", "Makefile"), "help:\n\t@sphinx-build -M help\n");
      const signals = scanRepo(tmpDir);
      expect(signals.makefile).toBeUndefined();
    });

    it("still prefers a root Makefile when both exist", () => {
      fs.mkdirSync(path.join(tmpDir, "docs"));
      fs.writeFileSync(path.join(tmpDir, "docs", "Makefile"), "help:\n\t@sphinx-build -M help\n");
      fs.writeFileSync(path.join(tmpDir, "Makefile"), "build:\n\tgcc main.c\n");
      const signals = scanRepo(tmpDir);
      expect(signals.makefile).toContain("gcc main.c");
    });
  });

  describe("with manifests saved as UTF-8 with BOM (common on Windows editors)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-scanner-bom-"));
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        "\uFEFF" + JSON.stringify({ dependencies: { express: "^4.19.0" }, devDependencies: {}, scripts: {} })
      );
      fs.writeFileSync(path.join(tmpDir, "go.mod"), "\uFEFFmodule example.com/app\n");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("still parses package.json instead of silently dropping it", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.packageJson?.dependencies.express).toBe("^4.19.0");
    });

    it("strips the BOM from text manifests so line-anchored regexes keep working", () => {
      const signals = scanRepo(tmpDir);
      expect(signals.goMod?.startsWith("module")).toBe(true);
    });
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
