import { describe, it, expect, vi } from "vitest";
import { collectLowConfidenceQuestions, askQuestions } from "../src/core/prompt-engine.js";
import type { DetectionResult } from "../src/core/types.js";

describe("collectLowConfidenceQuestions", () => {
  it("returns no questions when all fields are high confidence", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "react", confidence: "high" },
        testRunner: { value: "vitest", confidence: "high" },
      },
    ];
    expect(collectLowConfidenceQuestions(detections)).toEqual([]);
  });

  it("returns one question per low-confidence field", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "none", confidence: "low" },
        testRunner: { value: "vitest", confidence: "high" },
      },
    ];
    const questions = collectLowConfidenceQuestions(detections);
    expect(questions).toEqual([
      {
        packId: "js-ts",
        field: "framework",
        message: "No se pudo determinar el framework para TypeScript/JavaScript. ¿Cuál usáis?",
      },
    ]);
  });
});

describe("askQuestions", () => {
  it("calls promptFn once per question and maps answers by 'packId:field'", async () => {
    const promptFn = vi.fn().mockResolvedValue("express");
    const answers = await askQuestions(
      [{ packId: "js-ts", field: "framework", message: "¿Cuál framework?" }],
      promptFn
    );
    expect(promptFn).toHaveBeenCalledWith("¿Cuál framework?");
    expect(answers).toEqual({ "js-ts:framework": "express" });
  });
});
