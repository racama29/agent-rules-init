import { describe, it, expect } from "vitest";
import { cppPack } from "../../src/packs/cpp.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const CMAKE_QT_GTEST = `cmake_minimum_required(VERSION 3.20)
project(app)
find_package(Qt6 REQUIRED COMPONENTS Widgets)
find_package(GTest REQUIRED)
enable_testing()
`;

describe("cppPack", () => {
  it("returns null with no CMakeLists.txt or Makefile", () => {
    expect(cppPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Qt + gtest with high confidence from CMakeLists.txt", () => {
    const detection = cppPack.detect(baseSignals({ cmakeLists: CMAKE_QT_GTEST }));
    expect(detection?.framework).toEqual({ value: "qt", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "gtest", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "cmake", confidence: "high" });
  });

  it("reports make as the package manager when only a Makefile is present", () => {
    const detection = cppPack.detect(baseSignals({ makefile: "all:\n\tgcc -o app main.c\n" }));
    expect(detection?.packageManager).toEqual({ value: "make", confidence: "high" });
  });

  it("marks framework low confidence when no known library is found", () => {
    const detection = cppPack.detect(
      baseSignals({ cmakeLists: "cmake_minimum_required(VERSION 3.20)\nproject(app)\n" })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = cppPack.detect(
      baseSignals({ cmakeLists: "cmake_minimum_required(VERSION 3.20)\nproject(app)\n" })
    )!;
    const templates = cppPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
