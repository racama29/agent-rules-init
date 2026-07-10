import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCli, resolveCliAction, getVersion } from "../src/cli.js";

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

describe("resolveCliAction", () => {
  it("runs the generator when no flags are passed", () => {
    expect(resolveCliAction([])).toEqual({ kind: "run" });
  });

  it("resolves --help and -h to the help action", () => {
    expect(resolveCliAction(["--help"])).toEqual({ kind: "help" });
    expect(resolveCliAction(["-h"])).toEqual({ kind: "help" });
  });

  it("resolves --version and -v to the version action", () => {
    expect(resolveCliAction(["--version"])).toEqual({ kind: "version" });
    expect(resolveCliAction(["-v"])).toEqual({ kind: "version" });
  });

  it("reports an unknown flag instead of silently running the scan", () => {
    expect(resolveCliAction(["--wat"])).toEqual({ kind: "unknown", flag: "--wat" });
  });
});

describe("getVersion", () => {
  it("returns the version declared in package.json", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
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
      results.find((r) => r.path === ".claude/commands/js-ts-review.generated.md")?.status
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

  it("reflects the user's answer to a low-confidence question in the generated files", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    const promptFn = vi.fn().mockResolvedValue("custom-framework");
    await runCli(tmpDir, { promptFn, skipLlm: true });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("custom-framework");
  });

  it("falls back to the plain questionnaire when no pack detects anything", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(results.length).toBeGreaterThan(0);
  });

  it("reports every file as skipped (never error) when re-run on the same repo", async () => {
    const promptFn = vi.fn().mockResolvedValue("");
    await runCli(tmpDir, { promptFn, skipLlm: true });
    const secondRun = await runCli(tmpDir, { promptFn, skipLlm: true });

    expect(secondRun.length).toBeGreaterThan(0);
    expect(secondRun.every((r) => r.status === "skipped")).toBe(true);
    expect(secondRun.filter((r) => r.status === "error")).toEqual([]);
  });

  it("does not drop prompt files when two packs are detected in the same repo", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "requirements.txt"),
      "fastapi==0.115.0\npytest==8.3.0"
    );
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });
    const errors = results.filter((r) => r.status === "error");
    expect(errors).toEqual([]);
    expect(
      results.find((r) => r.path === ".claude/commands/js-ts-review.generated.md")?.status
    ).toBe("written");
    expect(
      results.find((r) => r.path === ".claude/commands/python-review.generated.md")?.status
    ).toBe("written");
  });
});
