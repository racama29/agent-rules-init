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
});
