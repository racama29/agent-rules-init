import { describe, it, expect } from "vitest";
import { swiftPack } from "../../src/packs/swift.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const PACKAGE_SWIFT_VAPOR = `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "app",
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.0.0"),
    ]
)
`;

describe("swiftPack", () => {
  it("returns null with no Package.swift", () => {
    expect(swiftPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Vapor with high confidence", () => {
    const detection = swiftPack.detect(baseSignals({ packageSwift: PACKAGE_SWIFT_VAPOR }));
    expect(detection?.framework).toEqual({ value: "vapor", confidence: "high" });
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = swiftPack.detect(
      baseSignals({ packageSwift: 'let package = Package(name: "app")' })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports swift test and swift package manager with high confidence", () => {
    const detection = swiftPack.detect(baseSignals({ packageSwift: 'let package = Package(name: "app")' }));
    expect(detection?.testRunner).toEqual({ value: "swift test", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "swift package manager", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = swiftPack.detect(baseSignals({ packageSwift: 'let package = Package(name: "app")' }))!;
    const templates = swiftPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
