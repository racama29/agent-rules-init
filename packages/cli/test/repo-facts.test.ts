import { describe, it, expect } from "vitest";
import { extractNpmCommands, extractComposerCommands } from "../src/core/repo-facts.js";
import type { RepoSignals } from "../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("extractNpmCommands", () => {
  it("maps scripts to npm run invocations with the script body as detail", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: { lint: "eslint .", test: "vitest run" },
          moduleType: "commonjs",
        },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm run lint", detail: "eslint ." });
  });

  it("uses the direct form for npm lifecycle scripts (test/start)", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { test: "vitest run" }, moduleType: "commonjs" },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest run" });
  });

  it("skips empty script bodies and returns [] without package.json", () => {
    expect(extractNpmCommands(baseSignals({}))).toEqual([]);
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { noop: "   " }, moduleType: "commonjs" },
      })
    );
    expect(entries).toEqual([]);
  });
});

describe("extractComposerCommands", () => {
  it("flattens string and array script values", () => {
    const entries = extractComposerCommands(
      baseSignals({
        composerJson: { require: {}, requireDev: {}, scripts: { test: "phpunit", check: ["phpcs", "phpstan"] } },
      })
    );
    expect(entries).toContainEqual({ source: "composer", invocation: "composer test", detail: "phpunit" });
    expect(entries).toContainEqual({ source: "composer", invocation: "composer check", detail: "phpcs && phpstan" });
  });

  it("skips non-string/non-array values and returns [] without composer.json", () => {
    expect(extractComposerCommands(baseSignals({}))).toEqual([]);
    const entries = extractComposerCommands(
      baseSignals({ composerJson: { require: {}, requireDev: {}, scripts: { weird: { nested: true } } } })
    );
    expect(entries).toEqual([]);
  });
});
