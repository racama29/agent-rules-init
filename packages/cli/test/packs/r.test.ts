import { describe, it, expect } from "vitest";
import { rPack } from "../../src/packs/r.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const DESCRIPTION_SHINY = `Package: myapp
Type: Package
Title: My Shiny App
Imports: shiny, testthat
`;

describe("rPack", () => {
  it("returns null with no DESCRIPTION or renv.lock", () => {
    expect(rPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Shiny + testthat with high confidence from DESCRIPTION", () => {
    const detection = rPack.detect(baseSignals({ rDescription: DESCRIPTION_SHINY }));
    expect(detection?.framework).toEqual({ value: "shiny", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "testthat", confidence: "high" });
  });

  it("reports renv as the package manager with high confidence when renv.lock is present", () => {
    const detection = rPack.detect(baseSignals({ renvLock: '{"Packages": {"shiny": {}}}' }));
    expect(detection?.packageManager).toEqual({ value: "renv", confidence: "high" });
  });

  it("reports CRAN with low confidence when only DESCRIPTION is present", () => {
    const detection = rPack.detect(baseSignals({ rDescription: "Package: myapp\n" }));
    expect(detection?.packageManager).toEqual({ value: "CRAN", confidence: "low" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = rPack.detect(baseSignals({ rDescription: "Package: myapp\n" }))!;
    const templates = rPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
