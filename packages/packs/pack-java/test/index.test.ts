import { describe, it, expect } from "vitest";
import { javaPack } from "../src/index.js";
import type { RepoSignals } from "agent-rules-pack-types";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("javaPack", () => {
  it("returns null with no pom.xml or build.gradle", () => {
    expect(javaPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Spring Boot + Maven from pom.xml with high confidence", () => {
    const detection = javaPack.detect(
      baseSignals({ pomXml: "<artifactId>spring-boot-starter-web</artifactId>" })
    );
    expect(detection?.framework).toEqual({ value: "spring", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "maven", confidence: "high" });
  });

  it("detects Gradle when build.gradle is present instead of pom.xml", () => {
    const detection = javaPack.detect(baseSignals({ buildGradle: "dependencies { }" }));
    expect(detection?.packageManager).toEqual({ value: "gradle", confidence: "high" });
  });

  it("marks framework low confidence when spring is not referenced", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }))!;
    const templates = javaPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
