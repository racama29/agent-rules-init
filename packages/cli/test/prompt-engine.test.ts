import { afterEach, describe, expect, it } from "vitest";
import { hasInteractiveTty } from "../src/core/prompt-engine.js";

describe("hasInteractiveTty", () => {
  const originalStdinTty = process.stdin.isTTY;
  const originalStdoutTty = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTty, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTty, configurable: true });
  });

  it("requires both stdin and stdout to be interactive", () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(hasInteractiveTty()).toBe(false);

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(hasInteractiveTty()).toBe(true);
  });
});
