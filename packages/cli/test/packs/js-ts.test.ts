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

  it('does not leak the "unknown" sentinel into the testing template when no test runner is detected', () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    )!;
    expect(detection.testRunner?.value).toBe("unknown");

    const testing = jsTsPack.promptTemplates(detection, "es").find((t) => t.id === "testing")!;
    expect(testing.body).not.toContain("unknown");
  });

  it("detects React + Vitest with high confidence", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
          moduleType: "commonjs",
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
          moduleType: "commonjs",
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "next", confidence: "high" });
  });

  it("detects Express as a backend framework", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { express: "^5.2.1" },
          devDependencies: {},
          scripts: {},
          moduleType: "commonjs",
        },
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
          moduleType: "commonjs",
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "nestjs", confidence: "high" });
  });

  it("detects Fastify", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { fastify: "^5.0.0" },
          devDependencies: {},
          scripts: {},
          moduleType: "commonjs",
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "fastify", confidence: "high" });
  });

  it("detects Koa", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: { koa: "^2.15.0" }, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    );
    expect(detection?.framework).toEqual({ value: "koa", confidence: "high" });
  });

  it("marks framework as low confidence when no known framework dependency is found", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    );
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("detects TypeScript from the typescript dependency", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: {},
          devDependencies: { typescript: "^5.6.0" },
          scripts: {},
          moduleType: "commonjs",
        },
      })
    );
    expect(detection?.usesTypeScript).toBe(true);
    expect(detection?.language).toBe("TypeScript");
  });

  it("detects TypeScript from a tsconfig.json even without the dependency listed", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        hasFile: (p) => p === "tsconfig.json",
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    );
    expect(detection?.usesTypeScript).toBe(true);
  });

  it("does not claim TypeScript for a plain JavaScript project", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    );
    expect(detection?.usesTypeScript).toBe(false);
    expect(detection?.language).toBe("JavaScript");
  });

  it("detects CommonJS vs ESM from package.json's type field", () => {
    const cjs = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    );
    const esm = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "module" },
      })
    );
    expect(cjs?.moduleFormat).toBe("commonjs");
    expect(esm?.moduleFormat).toBe("module");
  });

  it("produces rules mentioning the detected framework", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { react: "^18.3.0" },
          devDependencies: { vitest: "^2.1.0" },
          scripts: {},
          moduleType: "commonjs",
        },
      })
    )!;
    const rules = jsTsPack.rules(detection, "es");
    expect(rules.summary).toContain("react");
  });

  it("does not tell a plain CommonJS project to use TypeScript or import/export", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: { express: "^5.2.1" },
          devDependencies: { mocha: "^10.0.0" },
          scripts: {},
          moduleType: "commonjs",
        },
      })
    )!;
    const rules = jsTsPack.rules(detection, "es");
    expect(rules.conventions.join(" ")).not.toContain("TypeScript");
    expect(rules.conventions.join(" ")).toContain("CommonJS");
  });

  it("tells an ESM TypeScript project to use TypeScript and import/export", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          dependencies: {},
          devDependencies: { typescript: "^5.6.0", vitest: "^2.1.0" },
          scripts: {},
          moduleType: "module",
        },
      })
    )!;
    const rules = jsTsPack.rules(detection, "es");
    expect(rules.conventions.join(" ")).toContain("TypeScript");
    expect(rules.conventions.join(" ")).toContain("módulos ES");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      })
    )!;
    const templates = jsTsPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
