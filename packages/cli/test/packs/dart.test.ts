import { describe, it, expect } from "vitest";
import { dartPack } from "../../src/packs/dart.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const PUBSPEC_FLUTTER = `name: my_app
dependencies:
  flutter:
    sdk: flutter
dev_dependencies:
  flutter_test:
    sdk: flutter
`;

describe("dartPack", () => {
  it("returns null with no pubspec.yaml", () => {
    expect(dartPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Flutter + flutter test with high confidence", () => {
    const detection = dartPack.detect(baseSignals({ pubspecYaml: PUBSPEC_FLUTTER }));
    expect(detection?.framework).toEqual({ value: "flutter", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "flutter test", confidence: "high" });
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = dartPack.detect(baseSignals({ pubspecYaml: "name: my_cli_app\n" }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports pub as the package manager with high confidence", () => {
    const detection = dartPack.detect(baseSignals({ pubspecYaml: "name: my_cli_app\n" }));
    expect(detection?.packageManager).toEqual({ value: "pub", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = dartPack.detect(baseSignals({ pubspecYaml: "name: my_cli_app\n" }))!;
    const templates = dartPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
