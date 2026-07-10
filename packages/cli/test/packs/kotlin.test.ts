import { describe, it, expect } from "vitest";
import { kotlinPack } from "../../src/packs/kotlin.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const GRADLE_KTS_KTOR = `plugins {
    kotlin("jvm") version "1.9.0"
    application
}

dependencies {
    implementation("io.ktor:ktor-server-core:2.3.0")
    testImplementation("io.kotest:kotest-runner-junit5:5.6.0")
}
`;

describe("kotlinPack", () => {
  it("returns null with no build.gradle(.kts)", () => {
    expect(kotlinPack.detect(baseSignals({}))).toBeNull();
  });

  it("returns null when build.gradle does not apply the Kotlin plugin (plain Java)", () => {
    expect(kotlinPack.detect(baseSignals({ buildGradle: "dependencies { }" }))).toBeNull();
  });

  it("detects Ktor + Kotest with high confidence", () => {
    const detection = kotlinPack.detect(baseSignals({ buildGradle: GRADLE_KTS_KTOR }));
    expect(detection?.framework).toEqual({ value: "ktor", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "kotest", confidence: "high" });
  });

  it("detects the Kotlin plugin declared via a Gradle version catalog alias, not just literal plugin ids", () => {
    const versionCatalogGradle = `plugins {\n    alias(libs.plugins.kotlin.android) apply false\n}\n`;
    const detection = kotlinPack.detect(baseSignals({ buildGradle: versionCatalogGradle }));
    expect(detection).not.toBeNull();
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = kotlinPack.detect(baseSignals({ buildGradle: 'plugins {\n    kotlin("jvm")\n}' }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = kotlinPack.detect(baseSignals({ buildGradle: 'plugins {\n    kotlin("jvm")\n}' }))!;
    const templates = kotlinPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
