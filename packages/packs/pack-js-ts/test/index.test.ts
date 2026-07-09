import { describe, it, expect } from "vitest";
import { jsTsPack } from "../src/index.js";
import type { RepoSignals } from "../../../cli/src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return {
    rootPath: "/fake",
    files: [],
    hasFile: () => false,
    hasDir: () => false,
    ...overrides,
  };
}

describe("jsTsPack", () => {
  it("returns null when there is no package.json", () => {
    expect(jsTsPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects React + Vitest with high confidence", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "react", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "vitest", confidence: "high" });
  });

  it("marks framework as low confidence when no known framework dependency is found", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
      })
    );
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces rules mentioning the detected framework", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
        },
      })
    )!;
    const rules = jsTsPack.rules(detection);
    expect(rules.summary).toContain("react");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = jsTsPack.detect(
      baseSignals({ packageJson: { dependencies: {}, devDependencies: {}, scripts: {} } })
    )!;
    const templates = jsTsPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
