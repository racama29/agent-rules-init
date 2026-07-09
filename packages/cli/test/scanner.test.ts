import { describe, it, expect } from "vitest";
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
});
