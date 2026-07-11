import { describe, it, expect } from "vitest";
import { javaPack } from "../../src/packs/java.js";
import type { RepoSignals } from "../../src/core/types.js";

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

  it("returns null when build.gradle.kts applies the Kotlin plugin (defers to the Kotlin pack)", () => {
    const detection = javaPack.detect(
      baseSignals({ buildGradle: 'plugins {\n    kotlin("jvm") version "1.9.0"\n}' })
    );
    expect(detection).toBeNull();
  });

  it("defers Maven Kotlin builds to the Kotlin pack", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>kotlin-maven-plugin</artifactId>" }));
    expect(detection).toBeNull();
  });

  it("uses the Gradle wrapper when it is available", () => {
    const detection = javaPack.detect(baseSignals({
      buildGradle: "plugins { id 'java' }",
      hasFile: (file) => file === "gradlew",
    }));
    expect(detection?.packageManager?.value).toBe("gradle wrapper");
    expect(javaPack.rules(detection!, "en").conventions.join("\n")).toContain("./gradlew test");
  });

  it("uses the Maven wrapper when it is available", () => {
    const detection = javaPack.detect(baseSignals({
      pomXml: "<artifactId>plain-app</artifactId>",
      hasFile: (file) => file === "mvnw",
    }));
    expect(detection?.packageManager?.value).toBe("maven wrapper");
    expect(javaPack.rules(detection!, "en").conventions.join("\n")).toContain("./mvnw test");
  });

  it("reports testRunner as unknown, not junit, when junit is not referenced", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }));
    expect(detection?.testRunner).toEqual({ value: "unknown", confidence: "low" });
  });

  it('does not leak the "unknown" sentinel into the testing template when junit is not referenced', () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }))!;
    expect(detection.testRunner?.value).toBe("unknown");

    const testing = javaPack.promptTemplates(detection, "es").find((t) => t.id === "testing")!;
    expect(testing.body).not.toContain("unknown");
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = javaPack.detect(baseSignals({ pomXml: "<artifactId>plain-app</artifactId>" }))!;
    const templates = javaPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
