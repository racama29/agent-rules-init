import { describe, it, expect } from "vitest";
import { jsTsPack } from "../../src/packs/js-ts.js";
import type { RepoSignals } from "../../src/core/types.js";

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

  it("detects Next.js instead of plain React when both dependencies are present", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { next: "^14.0.0", react: "^18.3.0" },
          devDependencies: {},
          scripts: {},
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "next", confidence: "high" });
  });

  it("detects Express as a backend framework", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: { express: "^5.2.1" }, devDependencies: {}, scripts: {} },
      })
    );
    expect(detection?.framework).toEqual({ value: "express", confidence: "high" });
  });

  it("detects NestJS instead of Express when both are present", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { "@nestjs/core": "^10.0.0", express: "^4.18.0" },
          devDependencies: {},
          scripts: {},
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "nestjs", confidence: "high" });
  });

  it("detects Fastify", () => {
    const detection = jsTsPack.detect(
      baseSignals({ packageJson: { dependencies: { fastify: "^5.0.0" }, devDependencies: {}, scripts: {} } })
    );
    expect(detection?.framework).toEqual({ value: "fastify", confidence: "high" });
  });

  it("detects Koa", () => {
    const detection = jsTsPack.detect(
      baseSignals({ packageJson: { dependencies: { koa: "^2.15.0" }, devDependencies: {}, scripts: {} } })
    );
    expect(detection?.framework).toEqual({ value: "koa", confidence: "high" });
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
