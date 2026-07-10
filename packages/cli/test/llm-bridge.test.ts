import { describe, it, expect, vi } from "vitest";
import { detectAvailableAssistants, polishWithAssistant } from "../src/core/llm-bridge.js";

describe("detectAvailableAssistants", () => {
  it("returns both assistants when both exec calls succeed", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "1.0.0", exitCode: 0 });
    const result = await detectAvailableAssistants(execFn);
    expect(result.sort()).toEqual(["claude", "codex"]);
  });

  it("returns only the assistant whose exec call succeeds", async () => {
    const execFn = vi.fn().mockImplementation(async (command: string) => {
      if (command === "claude") return { stdout: "1.0.0", exitCode: 0 };
      throw new Error("command not found");
    });
    const result = await detectAvailableAssistants(execFn);
    expect(result).toEqual(["claude"]);
  });

  it("returns an empty array when no assistant is available", async () => {
    const execFn = vi.fn().mockRejectedValue(new Error("command not found"));
    const result = await detectAvailableAssistants(execFn);
    expect(result).toEqual([]);
  });
});

describe("polishWithAssistant", () => {
  it("passes the content via stdin (never as a CLI argument) and returns stdout", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "polished content", exitCode: 0 });
    const result = await polishWithAssistant("claude", "raw content", execFn);
    expect(result).toBe("polished content");
    expect(execFn).toHaveBeenCalledWith("claude", ["-p"], expect.stringContaining("raw content"));
  });

  it("includes multi-line content in stdin without truncation", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "polished", exitCode: 0 });
    const multilineContent = "# Title\n\n- one\n- two\n\n## Section\nsome text";
    await polishWithAssistant("claude", multilineContent, execFn);
    const stdinArg = execFn.mock.calls[0][2];
    expect(stdinArg).toContain(multilineContent);
  });

  it("falls back to the original content if the exec call fails", async () => {
    const execFn = vi.fn().mockRejectedValue(new Error("auth error"));
    const result = await polishWithAssistant("codex", "raw content", execFn);
    expect(result).toBe("raw content");
  });
});
