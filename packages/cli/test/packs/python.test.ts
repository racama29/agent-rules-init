import { describe, it, expect } from "vitest";
import { pythonPack } from "../../src/packs/python.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("pythonPack", () => {
  it("returns null with no pyproject.toml, requirements.txt or environment.yml", () => {
    expect(pythonPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects FastAPI + pytest from pyproject.toml with high confidence", () => {
    const detection = pythonPack.detect(
      baseSignals({ pyprojectToml: 'dependencies = ["fastapi", "pytest"]' })
    );
    expect(detection?.framework).toEqual({ value: "fastapi", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "pytest", confidence: "high" });
  });

  it("detects from requirements.txt when pyproject.toml is absent", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "django==5.0\npytest==8.3.0" }));
    expect(detection?.framework?.value).toBe("django");
  });

  it("detects from environment.yml (Conda) when no pip manifest is present", () => {
    const detection = pythonPack.detect(
      baseSignals({
        environmentYml: "name: my_env\ndependencies:\n  - python=3.9\n  - pip:\n    - flask\n    - pytest",
      })
    );
    expect(detection?.framework).toEqual({ value: "flask", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "conda", confidence: "high" });
  });

  it("does not mistake the package's own name for a framework dependency (e.g. Flask's own pyproject.toml)", () => {
    const flaskOwnPyproject = `[project]\nname = "flask"\ndependencies = [\n    "blinker>=1.9.0",\n    "click>=8.1.3",\n    "werkzeug>=3.1.0",\n]\n\n[dependency-groups]\ndev = [\n    "pytest",\n    "ruff",\n]\n`;
    const detection = pythonPack.detect(baseSignals({ pyprojectToml: flaskOwnPyproject }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
    expect(detection?.testRunner).toEqual({ value: "pytest", confidence: "high" });
  });

  it("marks framework low confidence when nothing recognizable is found", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "some-random-lib==1.0" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it('does not leak the "unknown" sentinel into rules or templates when no test runner is detected', () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "some-random-lib==1.0" }))!;
    expect(detection.testRunner?.value).toBe("unknown");

    const ruleSet = pythonPack.rules(detection, "es");
    expect(ruleSet.conventions.join("\n")).not.toContain("unknown");

    const testing = pythonPack.promptTemplates(detection, "es").find((t) => t.id === "testing")!;
    expect(testing.body).not.toContain("unknown");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "flask" }))!;
    const templates = pythonPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
