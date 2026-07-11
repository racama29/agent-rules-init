import { describe, it, expect } from "vitest";
import type { DetectionResult, Pack } from "../../src/core/types.js";
import { jsTsPack } from "../../src/packs/js-ts.js";
import { pythonPack } from "../../src/packs/python.js";
import { javaPack } from "../../src/packs/java.js";
import { phpPack } from "../../src/packs/php.js";
import { rubyPack } from "../../src/packs/ruby.js";
import { goPack } from "../../src/packs/go.js";
import { rustPack } from "../../src/packs/rust.js";
import { csharpPack } from "../../src/packs/csharp.js";
import { kotlinPack } from "../../src/packs/kotlin.js";
import { swiftPack } from "../../src/packs/swift.js";
import { dartPack } from "../../src/packs/dart.js";
import { cppPack } from "../../src/packs/cpp.js";
import { elixirPack } from "../../src/packs/elixir.js";
import { scalaPack } from "../../src/packs/scala.js";
import { rPack } from "../../src/packs/r.js";

const ALL_PACKS: Pack[] = [
  jsTsPack,
  pythonPack,
  javaPack,
  phpPack,
  rubyPack,
  goPack,
  rustPack,
  csharpPack,
  kotlinPack,
  swiftPack,
  dartPack,
  cppPack,
  elixirPack,
  scalaPack,
  rPack,
];

function syntheticDetection(pack: Pack): DetectionResult {
  return {
    packId: pack.id,
    language: pack.id,
    framework: { value: "none", confidence: "low" },
    testRunner: { value: "unknown", confidence: "low" },
    packageManager: { value: "unknown", confidence: "low" },
  };
}

describe("every pack renders English content with lang en", () => {
  for (const pack of ALL_PACKS) {
    it(`${pack.id}: rules and templates contain no Spanish when lang is en`, () => {
      const detection = syntheticDetection(pack);
      const ruleSet = pack.rules(detection, "en");
      const allText = [
        ruleSet.summary,
        ...ruleSet.conventions,
        ...ruleSet.architectureNotes,
        ...pack.promptTemplates(detection, "en").map((t) => t.body),
      ].join("\n");
      expect(allText).toContain("project");
      expect(allText).not.toMatch(/Proyecto|Ejecuta los tests|Señala solo|camino feliz|antes de terminar/);
      const testing = pack.promptTemplates(detection, "en").find((t) => t.id === "testing")!;
      expect(testing.body).toContain("happy path");
    });

    it(`${pack.id}: rules and templates keep Spanish with lang es`, () => {
      const detection = syntheticDetection(pack);
      const ruleSet = pack.rules(detection, "es");
      expect(ruleSet.summary).toContain("Proyecto");
      const testing = pack.promptTemplates(detection, "es").find((t) => t.id === "testing")!;
      expect(testing.body).toContain("camino feliz");
    });
  }
});
