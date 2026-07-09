import { describe, it, expect } from "vitest";
import { pythonPack } from "../src/index.js";
import type { RepoSignals } from "agent-rules-pack-types";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("pythonPack", () => {
  it("returns null with no pyproject.toml or requirements.txt", () => {
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

  it("marks framework low confidence when nothing recognizable is found", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "some-random-lib==1.0" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = pythonPack.detect(baseSignals({ requirementsTxt: "flask" }))!;
    const templates = pythonPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
