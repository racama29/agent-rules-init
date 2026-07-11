import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCli, resolveCliAction, getVersion, main } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";

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

  it("parses --lang with space and = forms", () => {
    expect(resolveCliAction(["--lang", "en"])).toEqual({ kind: "run", lang: "en" });
    expect(resolveCliAction(["--lang=es"])).toEqual({ kind: "run", lang: "es" });
  });

  it("parses composable automation flags", () => {
    expect(resolveCliAction(["--dry-run", "--json", "--non-interactive", "--lang=en"])).toEqual({
      kind: "run",
      dryRun: true,
      json: true,
      nonInteractive: true,
      lang: "en",
    });
    expect(resolveCliAction(["--check"])).toEqual({ kind: "run", check: true });
  });

  it("rejects an invalid --lang value", () => {
    expect(resolveCliAction(["--lang", "fr"])).toEqual({ kind: "invalid-lang", value: "fr" });
    expect(resolveCliAction(["--lang"])).toEqual({ kind: "invalid-lang", value: "" });
  });
});

describe("getVersion", () => {
  it("returns the version declared in package.json", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("automation output", () => {
  it("emits valid undecorated JSON and does not write in JSON dry-run mode", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--dry-run", "--json"];
    process.exitCode = undefined;

    try {
      await main();
      expect(log).toHaveBeenCalledOnce();
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(output).toEqual(
        expect.objectContaining({ mode: "dry-run", wouldCreate: expect.any(Number), results: expect.any(Array) })
      );
      expect(output.results[0]).toEqual(expect.objectContaining({ content: expect.any(String) }));
      expect(fs.existsSync(path.join(tmpDir, "CLAUDE.generated.md"))).toBe(false);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("makes --check fail when files are missing without writing them", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--check"];
    process.exitCode = undefined;

    try {
      await main();
      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, "CLAUDE.generated.md"))).toBe(false);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("makes --check fail when generated content is outdated", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "stale");
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--check", "--json"];
    process.exitCode = undefined;
    try {
      await main();
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(process.exitCode).toBe(1);
      expect(output.outdated).toContain("CLAUDE.generated.md");
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("makes --check pass after an unchanged generation", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--check", "--json"];
    process.exitCode = undefined;
    try {
      await main();
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(process.exitCode).toBeUndefined();
      expect(output.wouldCreate).toBe(0);
      expect(output.outdated).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });
});

describe("runCli", () => {
  it("generates package-scoped AGENTS files with config overrides", async () => {
    fs.mkdirSync(path.join(tmpDir, "apps", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "apps", "api", "package.json"),
      JSON.stringify({
        dependencies: { express: "^5.0.0" },
        devDependencies: {}, scripts: { test: "node --test" }, type: "module",
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, ".agent-rules-init.yml"),
      "lang: en\nnoAi: true\nprojects:\n  apps/api:\n    framework: internal-api\n"
    );

    const results = await runCli(tmpDir, { nonInteractive: true });
    expect(results.find((result) => result.path === "apps/api/AGENTS.generated.md")?.status).toBe("written");
    const scoped = fs.readFileSync(path.join(tmpDir, "apps", "api", "AGENTS.generated.md"), "utf8");
    expect(scoped).toContain("using internal-api");
    expect(scoped).toContain("`npm test` → `node --test`");
    expect(scoped).toContain("Generated by agent-rules-init");
  });

  it("honors configured package exclusions before global and scoped detection", async () => {
    fs.mkdirSync(path.join(tmpDir, "legacy", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "legacy", "api", "package.json"),
      JSON.stringify({ dependencies: { express: "^5" }, devDependencies: {}, scripts: {} })
    );
    fs.writeFileSync(path.join(tmpDir, ".agent-rules-init.yml"), "exclude:\n  - legacy/**\n");

    const generated: GeneratedFile[][] = [];
    const results = await runCli(tmpDir, {
      dryRun: true, nonInteractive: true,
      onGeneratedFiles: (files) => generated.push([...files]),
    });
    expect(results.some((result) => result.path.startsWith("legacy/"))).toBe(false);
    expect(generated[0].find((file) => file.path === "CLAUDE.generated.md")?.content).not.toContain("express");
  });

  it("plans generated files in dry-run mode without touching the filesystem", async () => {
    const generated = vi.fn();
    const results = await runCli(tmpDir, {
      dryRun: true,
      nonInteractive: true,
      onGeneratedFiles: generated,
    });

    expect(results.some((result) => result.status === "written")).toBe(true);
    expect(generated).toHaveBeenCalledOnce();
    expect(generated.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ path: "CLAUDE.generated.md", content: expect.stringContaining("react") })
    );
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.generated.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".claude"))).toBe(false);
  });

  it("reports existing files as satisfied in dry-run mode", async () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "manual content");
    const results = await runCli(tmpDir, { dryRun: true, nonInteractive: true });

    expect(results.find((result) => result.path === "CLAUDE.generated.md")?.status).toBe("skipped");
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf8")).toBe("manual content");
  });

  it("does not ask questions or inspect assistants in non-interactive mode", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    const promptFn = vi.fn().mockRejectedValue(new Error("must not prompt"));
    const execFn = vi.fn().mockRejectedValue(new Error("must not execute"));

    await runCli(tmpDir, { promptFn, execFn, nonInteractive: true });

    expect(promptFn).not.toHaveBeenCalled();
    expect(execFn).not.toHaveBeenCalled();
  });

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

  it("generates all general instruction files when no pack detects anything", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    const promptFn = vi.fn().mockResolvedValue("");
    const results = await runCli(tmpDir, { promptFn, skipLlm: true });
    expect(results.map((result) => result.path)).toEqual([
      "CLAUDE.generated.md",
      "AGENTS.generated.md",
      ".github/copilot-instructions.generated.md",
    ]);
  });

  it("includes repo facts sections (commands, structure, CI) in the generated files", async () => {
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".github", "workflows", "ci.yml"),
      "jobs:\n  test:\n    steps:\n      - run: npm ci\n"
    );
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.3.0" },
        devDependencies: { vitest: "^2.1.0" },
        scripts: { test: "vitest run" },
      })
    );

    const promptFn = vi.fn().mockResolvedValue("");
    await runCli(tmpDir, { promptFn, skipLlm: true });

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("## Comandos del repo");
    expect(claudeMd).toContain("- `npm test` → `vitest run` (package.json)");
    expect(claudeMd).toContain("- `src/` — código fuente");
    expect(claudeMd).toContain("- `npm ci` (ci.yml)");
    const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8");
    expect(agentsMd).toContain("## Comandos del repo");
  });

  it("includes repo facts in the fallback file when no stack is detected", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    fs.writeFileSync(path.join(tmpDir, "Makefile"), "deploy:\n\trsync -a site/ server:/var/www\n");
    const promptFn = vi.fn().mockResolvedValue("");
    await runCli(tmpDir, { promptFn, skipLlm: true });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("No se detectó ningún stack conocido");
    expect(claudeMd).toContain("- `make deploy` (Makefile)");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8")).toContain("make deploy");
  });

  it("generates fully English output with lang en", async () => {
    const promptFn = vi.fn().mockResolvedValue("");
    await runCli(tmpDir, { promptFn, skipLlm: true, lang: "en" });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("Generated by agent-rules-init");
    expect(claudeMd).not.toMatch(/Proyecto|Comandos del repo|Ejecuta los tests|Generado por/);
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
