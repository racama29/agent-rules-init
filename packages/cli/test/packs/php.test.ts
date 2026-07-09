import { describe, it, expect } from "vitest";
import { phpPack } from "../../src/packs/php.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("phpPack", () => {
  it("returns null with no composer.json", () => {
    expect(phpPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Laravel + PHPUnit with high confidence", () => {
    const detection = phpPack.detect(
      baseSignals({
        composerJson: {
          require: { "laravel/framework": "^11.0" },
          requireDev: { "phpunit/phpunit": "^11.0" },
        },
      })
    );
    expect(detection?.framework).toEqual({ value: "laravel", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "phpunit", confidence: "high" });
  });

  it("marks framework low confidence when no known framework dependency is found", () => {
    const detection = phpPack.detect(
      baseSignals({ composerJson: { require: {}, requireDev: {} } })
    );
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("always reports composer as the package manager with high confidence", () => {
    const detection = phpPack.detect(baseSignals({ composerJson: { require: {}, requireDev: {} } }));
    expect(detection?.packageManager).toEqual({ value: "composer", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = phpPack.detect(
      baseSignals({ composerJson: { require: {}, requireDev: {} } })
    )!;
    const templates = phpPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
