import { describe, it, expect } from "vitest";
import { jsTsPack } from "../../src/packs/js-ts.js";
import type { RepoSignals } from "../../src/core/types.js";
import { buildRepoFacts } from "../../src/core/repo-facts.js";

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
  it("recognizes framework source packages without claiming a self-dependency", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          name: "express", dependencies: {}, devDependencies: { mocha: "^11" },
          scripts: {}, moduleType: "commonjs",
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "high" });
    expect(detection?.frameworkSource).toBe("express");
  });

  it("keeps framework-specific review risks for the framework's own source repo", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: {
          name: "express", dependencies: {}, devDependencies: { mocha: "^11" },
          scripts: {}, moduleType: "commonjs",
        },
      })
    )!;
    const review = jsTsPack.promptTemplates(detection, "en", {
      facts: { commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0,
        canonical: [], testDirs: ["test/"], entrypoints: [] },
    }).find((template) => template.id === "review")!;
    expect(review.body).toContain("next(err)");
    expect(review.body).not.toContain("using express");
  });
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

  it.each(["npm", "pnpm", "yarn", "bun"] as const)(
    "uses a resolved %s package manager signal",
    (packageManager) => {
      const detection = jsTsPack.detect(baseSignals({
        packageJson: {
          packageManager,
          dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "module",
        },
      }));
      expect(detection?.packageManager).toEqual({ value: packageManager, confidence: "high" });
    }
  );

  it("detects Bun from either lock format", () => {
    const detection = jsTsPack.detect(baseSignals({
      files: ["apps/web/bun.lock"],
      packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "module" },
    }));
    expect(detection?.packageManager).toEqual({ value: "bun", confidence: "high" });
  });

  it("infers a single package manager consistently used by CI", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
        githubWorkflows: [{
          path: ".github/workflows/ci.yml",
          content: "steps:\n  - run: npm ci\n  - run: |\n      npm test\n",
        }],
      })
    );
    expect(detection?.packageManager).toEqual({ value: "npm", confidence: "high" });
  });

  it("does not guess when CI uses multiple package managers", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
        githubWorkflows: [{ path: ".github/workflows/ci.yml", content: "npm test\npnpm test\n" }],
      })
    );
    expect(detection?.packageManager).toEqual({ value: "npm", confidence: "low" });
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

  it("does not mention typing errors in the review prompt for plain JavaScript", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: { mocha: "^10" }, scripts: {}, moduleType: "commonjs" },
      })
    )!;
    expect(detection.usesTypeScript).toBe(false);
    for (const lang of ["es", "en"] as const) {
      const review = jsTsPack.promptTemplates(detection, lang).find((t) => t.id === "review")!;
      expect(review.body).not.toMatch(/tipado|typing/i);
    }
  });

  it("keeps typing errors in the review prompt for TypeScript projects", () => {
    const detection = jsTsPack.detect(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: { typescript: "^5" }, scripts: {}, moduleType: "module" },
      })
    )!;
    expect(detection.usesTypeScript).toBe(true);
    const review = jsTsPack.promptTemplates(detection, "en").find((t) => t.id === "review")!;
    expect(review.body).toMatch(/typing/i);
  });
});

function expressLikeSignalsAndDetection() {
  const signals = baseSignals({
    files: ["lib/app.js", "test/app.test.js", "test/acceptance/routes.test.js", "package-lock.json"],
    hasFile: (p) => p === "package-lock.json",
    packageJson: {
      main: "lib/app.js",
      dependencies: { express: "^4.19.0" },
      devDependencies: { mocha: "^10.4.0", eslint: "^9.0.0" },
      scripts: { test: "mocha --recursive test/", lint: "eslint lib/ test/" },
      moduleType: "commonjs",
    },
  });
  const detection = jsTsPack.detect(signals)!;
  const ctx = { facts: buildRepoFacts(signals, "en") };
  return { detection, ctx };
}

describe("enriched js-ts prompts", () => {
  it("review prompt cites real commands, paths and module format", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const review = jsTsPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "review")!;
    expect(review.body).toContain("`npm test`");
    expect(review.body).toContain("`npm run lint`");
    expect(review.body).toContain("`test/`");
    expect(review.body).toContain("CommonJS");
    expect(review.body).toContain("next(err)");
    expect(review.body).not.toMatch(/typing|tipado/i);
  });

  it("testing prompt uses the canonical test command and real test dirs", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const testing = jsTsPack.promptTemplates(detection, "en", ctx).find((t) => t.id === "testing")!;
    expect(testing.body).toContain("`npm test`");
    expect(testing.body).toContain("`test/`");
  });

  it("rules use the canonical test command instead of the runner name", () => {
    const { detection, ctx } = expressLikeSignalsAndDetection();
    const ruleSet = jsTsPack.rules(detection, "en", ctx);
    expect(ruleSet.conventions.join("\n")).toContain("npm test");
  });

  it("prompts still render without a context (backwards compatible)", () => {
    const { detection } = expressLikeSignalsAndDetection();
    const templates = jsTsPack.promptTemplates(detection, "en");
    expect(templates).toHaveLength(3);
  });
});
