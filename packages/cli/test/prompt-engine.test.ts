import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  collectLowConfidenceQuestions,
  askQuestions,
  applyAnswers,
  defaultPromptFn,
  hasInteractiveTty,
} from "../src/core/prompt-engine.js";
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

describe("applyAnswers", () => {
  it("overrides a low-confidence field with the user's answer at high confidence", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "none", confidence: "low" },
      },
    ];
    const updated = applyAnswers(detections, { "js-ts:framework": "express" });
    expect(updated[0].framework).toEqual({ value: "express", confidence: "high" });
  });

  it("leaves fields untouched when there is no matching answer", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "react", confidence: "high" },
      },
    ];
    const updated = applyAnswers(detections, {});
    expect(updated[0].framework).toEqual({ value: "react", confidence: "high" });
  });

  it("ignores an empty-string answer instead of overriding with a blank value", () => {
    const detections: DetectionResult[] = [
      {
        packId: "js-ts",
        language: "TypeScript/JavaScript",
        framework: { value: "none", confidence: "low" },
      },
    ];
    const updated = applyAnswers(detections, { "js-ts:framework": "" });
    expect(updated[0].framework).toEqual({ value: "none", confidence: "low" });
  });
});

describe("without an interactive TTY (e.g. Git Bash on Windows, CI, some VS Code terminal setups)", () => {
  let originalStdinTty: boolean | undefined;
  let originalStdoutTty: boolean | undefined;

  beforeEach(() => {
    originalStdinTty = process.stdin.isTTY;
    originalStdoutTty = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTty, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTty, configurable: true });
  });

  it("hasInteractiveTty reports false", () => {
    expect(hasInteractiveTty()).toBe(false);
  });

  it("defaultPromptFn resolves to an empty string instead of trying to render a prompt", async () => {
    const answer = await defaultPromptFn("¿Cuál framework?");
    expect(answer).toBe("");
  });
});
