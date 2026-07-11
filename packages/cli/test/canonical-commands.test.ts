import { describe, it, expect } from "vitest";
import { selectCanonicalCommands } from "../src/core/canonical-commands.js";
import type { CiCommand, CommandEntry, RepoSignals } from "../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals> = {}): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const none: CiCommand[] = [];

describe("selectCanonicalCommands", () => {
  it("picks test and lint from root manifest scripts", () => {
    const commands: CommandEntry[] = [
      { source: "npm", invocation: "npm test", detail: "mocha --recursive test/" },
      { source: "npm", invocation: "npm run lint", detail: "eslint lib/ test/" },
      { source: "npm", invocation: "npm run docs", detail: "jsdoc" },
    ];
    const result = selectCanonicalCommands(baseSignals(), commands, none);
    expect(result).toEqual([
      { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
      { kind: "lint", command: "npm run lint", source: "package.json", confidence: "high", scope: "." },
    ]);
  });

  it("ignores nested workspace manifests when picking root commands", () => {
    const commands: CommandEntry[] = [
      { source: "pnpm", invocation: "pnpm --dir apps/web run test", manifestPath: "apps/web/package.json" },
    ];
    expect(selectCanonicalCommands(baseSignals(), commands, none)).toEqual([]);
  });

  it("falls back to CI commands when no script matches", () => {
    const ci: CiCommand[] = [
      { command: "./mvnw -B verify", workflow: "build.yml" },
      { command: "./gradlew build", workflow: "build.yml" },
    ];
    const result = selectCanonicalCommands(baseSignals(), [], ci);
    expect(result).toEqual([
      { kind: "test", command: "./mvnw -B verify", source: "ci: build.yml", confidence: "high", scope: "." },
      { kind: "build", command: "./gradlew build", source: "ci: build.yml", confidence: "high", scope: "." },
    ]);
  });

  it("prefers a manifest script over a CI command of the same kind", () => {
    const commands: CommandEntry[] = [{ source: "npm", invocation: "npm test", detail: "vitest run" }];
    const ci: CiCommand[] = [{ command: "npm test -- --coverage", workflow: "ci.yml" }];
    const result = selectCanonicalCommands(baseSignals(), commands, ci);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("npm test");
    expect(result[0].source).toBe("package.json");
  });

  it("recognizes uv-run pytest in CI", () => {
    const ci: CiCommand[] = [{ command: "uv run pytest", workflow: "tests.yml" }];
    expect(selectCanonicalCommands(baseSignals(), [], ci)).toEqual([
      { kind: "test", command: "uv run pytest", source: "ci: tests.yml", confidence: "high", scope: "." },
    ]);
  });
});
