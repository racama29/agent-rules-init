import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCli } from "../src/cli.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-cli-"));
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      dependencies: { react: "^18.3.0" },
      devDependencies: { vitest: "^2.1.0" },
    })
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runCli", () => {
  it("generates CLAUDE.md, AGENTS.md, copilot-instructions and prompt files for a JS/TS repo", async () => {
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });

    expect(results.find((r) => r.path === "CLAUDE.generated.md")?.status).toBe("written");
    expect(results.find((r) => r.path === "AGENTS.generated.md")?.status).toBe("written");
    expect(
      results.find((r) => r.path === ".github/copilot-instructions.generated.md")?.status
    ).toBe("written");
    expect(
      results.find((r) => r.path === ".claude/commands/review.generated.md")?.status
    ).toBe("written");

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("react");
  });

  it("asks a question when a pack detects with low confidence", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    const promptFn = vi.fn().mockResolvedValue("custom-framework");
    await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(promptFn).toHaveBeenCalled();
  });

  it("falls back to the plain questionnaire when no pack detects anything", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(results.length).toBeGreaterThan(0);
  });
});
