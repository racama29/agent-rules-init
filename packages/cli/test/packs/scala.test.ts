import { describe, it, expect } from "vitest";
import { scalaPack } from "../../src/packs/scala.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const BUILD_SBT_PLAY = `libraryDependencies ++= Seq(
  guice,
  "org.playframework" %% "play" % "3.0.0",
  "org.scalatest" %% "scalatest" % "3.2.17" % Test
)
`;

describe("scalaPack", () => {
  it("returns null with no build.sbt", () => {
    expect(scalaPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Play + ScalaTest with high confidence", () => {
    const detection = scalaPack.detect(baseSignals({ buildSbt: BUILD_SBT_PLAY }));
    expect(detection?.framework).toEqual({ value: "play", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "scalatest", confidence: "high" });
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = scalaPack.detect(baseSignals({ buildSbt: 'name := "app"\n' }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports sbt as the package manager with high confidence", () => {
    const detection = scalaPack.detect(baseSignals({ buildSbt: 'name := "app"\n' }));
    expect(detection?.packageManager).toEqual({ value: "sbt", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = scalaPack.detect(baseSignals({ buildSbt: 'name := "app"\n' }))!;
    const templates = scalaPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
