import { describe, it, expect } from "vitest";
import { renderAssistantGreeting } from "../src/core/greeting.js";

describe("renderAssistantGreeting", () => {
  it("includes the assistant name in the greeting", () => {
    expect(renderAssistantGreeting("claude")).toContain("claude");
  });

  it("renders a multi-line ASCII banner", () => {
    const lines = renderAssistantGreeting("codex").split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });
});
