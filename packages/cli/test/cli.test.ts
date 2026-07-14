import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runCli, resolveCliAction, getVersion, main } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";
import type { RepoFacts } from "../src/core/types.js";

const FIXTURES_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");
const expressFixturePath = path.join(FIXTURES_ROOT, "node-express-mocha");

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

function promptFilesJson(stdin: string): string {
  const filesJson = stdin.match(
    /<(?:datos_no_confiables_entrada_json|untrusted_input_json)>\n([\s\S]*?)\n<\//
  )?.[1];
  if (!filesJson) throw new Error("input JSON boundary not found");
  return filesJson;
}

/** Simula un `claude` instalado que devuelve cada archivo con el contenido enriquecido. */
function makeEnrichExecFn() {
  return vi.fn().mockImplementation(async (command: string, args: string[], stdin?: string) => {
    if (args[0] === "--version") {
      if (command === "claude") return { stdout: "1.0.0", exitCode: 0 };
      throw new Error("command not found");
    }
    const filesJson = promptFilesJson(stdin!);
    const files = JSON.parse(filesJson) as { path: string; content: string }[];
    return {
      stdout: JSON.stringify(files.map((file) => ({ ...file, content: `ENRIQUECIDO\n${file.content}` }))),
      exitCode: 0,
    };
  });
}

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
    expect(resolveCliAction(["--force"])).toEqual({ kind: "run", force: true });
    expect(resolveCliAction(["--apply"])).toEqual({ kind: "run", apply: true });
  });

  it("parses --enrich", () => {
    expect(resolveCliAction(["--enrich"])).toEqual({ kind: "run", enrich: true });
    expect(resolveCliAction(["--enrich", "--non-interactive"])).toEqual({
      kind: "run",
      enrich: true,
      nonInteractive: true,
    });
  });

  it("parses --assistant and --model", () => {
    expect(resolveCliAction(["--assistant", "codex"])).toEqual({ kind: "run", assistant: "codex" });
    expect(resolveCliAction(["--assistant=claude", "--model=haiku"])).toEqual({
      kind: "run",
      assistant: "claude",
      model: "haiku",
    });
    expect(resolveCliAction(["--model", "gpt-5.5"])).toEqual({ kind: "run", model: "gpt-5.5" });
  });

  it("parses the explicit interview and portable context options", () => {
    expect(resolveCliAction(["--interview"])).toEqual({ kind: "run", interview: true });
    expect(resolveCliAction(["--context-file", "team-context.yml"])).toEqual({
      kind: "run", contextFile: "team-context.yml",
    });
    expect(resolveCliAction(["--context-file=team-context.yml"])).toEqual({
      kind: "run", contextFile: "team-context.yml",
    });
    expect(resolveCliAction(["--context-file"])).toEqual({ kind: "missing-value", flag: "--context-file" });
  });

  it("rejects an invalid --assistant value and a missing --model value", () => {
    expect(resolveCliAction(["--assistant", "cursor"])).toEqual({ kind: "invalid-assistant", value: "cursor" });
    expect(resolveCliAction(["--model"])).toEqual({ kind: "missing-value", flag: "--model" });
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

  it("imports portable maintainer context while keeping JSON output machine-readable", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    fs.writeFileSync(path.join(tmpDir, "team-context.yml"), `
intent:
  purpose: Keep the CLI predictable for platform teams
  priorities: [correctness]
  autonomy: plan-first
  boundaries: [Do not break the public API]
task:
  goal: Review the release path
  successCriteria: [No regressions]
  fallback: ask
`);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--dry-run", "--json", "--context-file", "team-context.yml"];
    process.exitCode = undefined;
    try {
      await main();
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(output.configWarnings).toEqual([]);
      expect(output.results.find((result: { path: string }) => result.path === "CLAUDE.generated.md").content)
        .toContain("Keep the CLI predictable for platform teams");
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("rejects an interview in automation mode before attempting to prompt", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--interview", "--json"];
    process.exitCode = undefined;
    try {
      await main();
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("--interview requires"));
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
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

  it("parses enrichment latency and cache controls", () => {
    expect(resolveCliAction([
      "--enrich-timeout=60", "--enrich-retries", "0", "--no-enrich-cache",
    ])).toEqual({
      kind: "run",
      enrichTimeoutSeconds: 60,
      enrichRetries: 0,
      noEnrichCache: true,
    });
    expect(resolveCliAction(["--enrich-timeout", "5"])).toEqual({ kind: "invalid-timeout", value: "5" });
    expect(resolveCliAction(["--enrich-retries", "3"])).toEqual({ kind: "invalid-retries", value: "3" });
  });

  it("makes --check accept an activated final file when its generated staging file was renamed", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.renameSync(path.join(tmpDir, "CLAUDE.generated.md"), path.join(tmpDir, "CLAUDE.md"));
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
      expect(output.missing).toEqual([]);
      expect(output.outdated).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("makes --check fail when an active file is stale even if staging is current", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "stale active content");
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
      expect(output.fileStates.find((state: { generatedPath: string }) =>
        state.generatedPath === "CLAUDE.generated.md"
      )).toEqual(expect.objectContaining({ activeExists: true, effectivePath: "CLAUDE.md", current: false }));
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("checks enriched active files against the recorded accepted output", async () => {
    const execFn = makeEnrichExecFn();
    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });
    fs.renameSync(path.join(tmpDir, "CLAUDE.generated.md"), path.join(tmpDir, "CLAUDE.md"));
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
      expect(output.baselineCurrent).toBe(true);
      expect(output.outdated).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("makes --check fail when repository changes invalidate the recorded baseline", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3.5.0" }, devDependencies: { vitest: "^2.1.0" } })
    );
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
      expect(output.baselineCurrent).toBe(false);
      expect(output.outdated.length).toBeGreaterThan(0);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      cwd.mockRestore();
      log.mockRestore();
    }
  });

  it("applies generated files through the CLI and reports backups in JSON", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "old active rules");
    const expected = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf8");
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = ["node", "agent-rules-init", "--apply", "--json"];
    process.exitCode = undefined;
    try {
      await main();
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(process.exitCode).toBeUndefined();
      expect(output.mode).toBe("apply");
      const applied = output.activationResults.find(
        (result: { activePath: string }) => result.activePath === "CLAUDE.md"
      );
      expect(applied).toEqual(expect.objectContaining({ status: "applied", backupPath: expect.any(String) }));
      expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf8")).toBe(expected);
      expect(fs.existsSync(path.join(tmpDir, applied.backupPath))).toBe(true);
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
    expect(scoped).toContain("- test: `npm test` (package.json)");
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

  it("force refreshes generated files without changing activated final files", async () => {
    await runCli(tmpDir, { nonInteractive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "stale staging");
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "manual final");

    const results = await runCli(tmpDir, { nonInteractive: true, force: true });

    expect(results.find((result) => result.path === "CLAUDE.generated.md")?.status).toBe("overwritten");
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf8")).not.toBe("stale staging");
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf8")).toBe("manual final");
  });

  it("does not inspect assistants during a normal run", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    const execFn = vi.fn().mockRejectedValue(new Error("must not execute"));

    await runCli(tmpDir, { execFn });

    expect(execFn).not.toHaveBeenCalled();
  });

  it("runs enrichment without prompting when enrich is set, even non-interactively", async () => {
    const execFn = makeEnrichExecFn();

    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("ENRIQUECIDO");
  });

  it("spawns the assistant at the target repo root during enrichment", async () => {
    const execFn = makeEnrichExecFn();
    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });
    const enrichCall = execFn.mock.calls.find((call) => call[1][0] === "-p");
    expect(enrichCall?.[3]).toBe(tmpDir);
  });

  it("passes existing hand-maintained docs to the assistant during enrichment", async () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "REGLA-MANUAL: nunca romper la API pública");
    const execFn = makeEnrichExecFn();

    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });

    const enrichCall = execFn.mock.calls.find((call) => call[1][0] === "-p");
    expect(enrichCall?.[2]).toContain("REGLA-MANUAL: nunca romper la API pública");
  });

  it("honors the requested assistant instead of the first detected one", async () => {
    const execFn = vi.fn().mockImplementation(async (command: string, args: string[], stdin?: string) => {
      if (args[0] === "--version") return { stdout: "1.0.0", exitCode: 0 };
      const filesJson = promptFilesJson(stdin!);
      const files = JSON.parse(filesJson) as { path: string; content: string }[];
      return { stdout: JSON.stringify(files), exitCode: 0 };
    });

    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true, assistant: "codex", model: "gpt-5.5" });

    const enrichCall = execFn.mock.calls.find((call) => call[1][0] !== "--version");
    expect(enrichCall?.[0]).toBe("codex");
    expect(enrichCall?.[1]).toEqual([
      "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral",
      "--model", "gpt-5.5", "-",
    ]);
  });

  it("reuses verified enrichment without launching the assistant when inputs are unchanged", async () => {
    const execFn = makeEnrichExecFn();
    const metrics: Array<{ cacheHit: boolean }> = [];
    await runCli(tmpDir, {
      execFn, nonInteractive: true, enrich: true,
      onEnrichMetrics: (value) => metrics.push(value),
    });
    const callsAfterFirstRun = execFn.mock.calls.filter((call) => call[1][0] !== "--version").length;

    await runCli(tmpDir, {
      execFn, nonInteractive: true, enrich: true, force: true,
      onEnrichMetrics: (value) => metrics.push(value),
    });

    expect(execFn.mock.calls.filter((call) => call[1][0] !== "--version")).toHaveLength(callsAfterFirstRun);
    expect(metrics.map((value) => value.cacheHit)).toEqual([false, true]);

    await runCli(tmpDir, {
      execFn, nonInteractive: true, enrich: true, force: true, noEnrichCache: true,
    });
    expect(execFn.mock.calls.filter((call) => call[1][0] !== "--version")).toHaveLength(callsAfterFirstRun + 1);
  });

  it("invalidates enrichment cache after a repository edit or staging tamper", async () => {
    const execFn = makeEnrichExecFn();
    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });
    const enrichmentCalls = () => execFn.mock.calls.filter((call) => call[1][0] !== "--version").length;
    expect(enrichmentCalls()).toBe(1);

    fs.writeFileSync(path.join(tmpDir, "source.ts"), "export const changed = true;\n");
    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true, force: true });
    expect(enrichmentCalls()).toBe(2);

    fs.appendFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "\ntampered\n");
    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true, force: true });
    expect(enrichmentCalls()).toBe(3);
  });

  it("uses enrichment assistant and model preferences only with explicit enrich", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".agent-rules-init.yml"),
      "assistant: codex\nmodel: gpt-5.5\n"
    );
    const execFn = vi.fn().mockImplementation(async (_command: string, args: string[], stdin?: string) => {
      if (args[0] === "--version") return { stdout: "1.0.0", exitCode: 0 };
      const filesJson = promptFilesJson(stdin!);
      return { stdout: JSON.stringify(JSON.parse(filesJson)), exitCode: 0 };
    });

    await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });

    const enrichCall = execFn.mock.calls.find((call) => call[1][0] !== "--version");
    expect(enrichCall?.[0]).toBe("codex");
    expect(enrichCall?.[1]).toContain("gpt-5.5");
  });

  it("warns and keeps the generated files when the requested assistant is not installed", async () => {
    const execFn = vi.fn().mockImplementation(async (command: string) => {
      if (command === "claude") return { stdout: "1.0.0", exitCode: 0 };
      throw new Error("command not found");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true, assistant: "codex" });

    expect(results.find((r) => r.path === "CLAUDE.generated.md")?.status).toBe("written");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("codex"));
    expect(execFn.mock.calls.every((call) => call[1][0] === "--version")).toBe(true);
    warn.mockRestore();
  });

  it("keeps the generated files when enrich is set but no assistant is installed", async () => {
    const execFn = vi.fn().mockRejectedValue(new Error("command not found"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await runCli(tmpDir, { execFn, nonInteractive: true, enrich: true });

    expect(results.find((r) => r.path === "CLAUDE.generated.md")?.status).toBe("written");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("generates CLAUDE.md, AGENTS.md, copilot-instructions and prompt files for a JS/TS repo", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.3.0" },
        devDependencies: { vitest: "^2.1.0" },
        scripts: { test: "vitest run" },
      })
    );
    const results = await runCli(tmpDir, { skipLlm: true });

    expect(results.find((r) => r.path === "CLAUDE.generated.md")?.status).toBe("written");
    expect(results.find((r) => r.path === "AGENTS.generated.md")?.status).toBe("written");
    expect(
      results.find((r) => r.path === ".github/copilot-instructions.generated.md")?.status
    ).toBe("written");
    expect(results.find((r) => r.path === ".cursor/rules/repository.generated.mdc")?.status).toBe("written");
    expect(results.find((r) => r.path === "GEMINI.generated.md")?.status).toBe("written");
    expect(
      results.find((r) => r.path === ".claude/commands/js-ts-review.generated.md")?.status
    ).toBe("written");

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("react");
  });

  it("propagates session intent and task context through generated consumers and prompts", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { react: "^18.3.0" },
      devDependencies: { vitest: "^2.1.0" },
      scripts: { test: "vitest run" },
    }));
    await runCli(tmpDir, {
      skipLlm: true,
      lang: "en",
      intent: {
        purpose: "Keep the CLI predictable for platform teams",
        priorities: ["correctness"],
        assistantRoles: ["implementation"],
        autonomy: "plan-first",
        boundaries: ["Do not break the public API"],
        doneCriteria: ["All checks pass"],
        decisions: ["Node 18 remains supported"],
      },
      task: {
        goal: "Reduce startup time without reducing detection quality",
        successCriteria: ["Startup remains below 100 ms"],
        allowedPaths: ["packages/cli"],
        fallback: "ask",
        restrictions: ["No new runtime dependencies"],
      },
    });
    const claude = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf8");
    const review = fs.readFileSync(path.join(tmpDir, ".claude/commands/js-ts-review.generated.md"), "utf8");
    expect(claude).toContain("Keep the CLI predictable for platform teams");
    expect(claude).toContain("Reduce startup time without reducing detection quality");
    expect(review).toContain("Current task provided by the maintainer");
    expect(review).toContain("No new runtime dependencies");
  });

  it("does not ask users to identify low-confidence project metadata", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {}, devDependencies: {} }));
    await runCli(tmpDir, { skipLlm: true });
  });

  it("renders conservative Go guidance without asking when no framework is detected", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/plain\n\ngo 1.22\n");
    await runCli(tmpDir, { skipLlm: true, lang: "es" });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("Proyecto Go (go modules).");
    expect(claudeMd).toContain("`go test ./...`");
  });

  it("generates all general instruction files when no pack detects anything", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    const results = await runCli(tmpDir, { skipLlm: true });
    expect(results.map((result) => result.path)).toEqual([
      "CLAUDE.generated.md",
      "AGENTS.generated.md",
      ".github/copilot-instructions.generated.md",
      ".cursor/rules/repository.generated.mdc",
      "GEMINI.generated.md",
    ]);
  });

  it("distributes repo facts according to each consumer", async () => {
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

    // lang fijado: sin él, el contenido esperado dependería del locale de la máquina.
    await runCli(tmpDir, { skipLlm: true, lang: "es" });

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("## Comandos del repo");
    expect(claudeMd).toContain("- `npm test` → `vitest run` (package.json)");
    expect(claudeMd).toContain("- `src/` — código fuente");
    expect(claudeMd).toContain("- `npm ci` (ci.yml)");
    const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8");
    expect(agentsMd).toContain("- test: `npm test` (package.json)");
    expect(agentsMd).not.toContain("## Comandos del repo");
    const copilot = fs.readFileSync(path.join(tmpDir, ".github", "copilot-instructions.generated.md"), "utf-8");
    expect(copilot).not.toContain("npm test");
    expect(copilot).not.toContain("npm ci");
  });

  it("includes repo facts in the fallback file when no stack is detected", async () => {
    fs.rmSync(path.join(tmpDir, "package.json"));
    fs.writeFileSync(path.join(tmpDir, "Makefile"), "deploy:\n\trsync -a site/ server:/var/www\n");
    await runCli(tmpDir, { skipLlm: true, lang: "es" });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("No se detectó ningún stack conocido");
    expect(claudeMd).toContain("- `make deploy` (Makefile)");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8")).not.toContain("make deploy");
    expect(fs.readFileSync(path.join(tmpDir, ".github", "copilot-instructions.generated.md"), "utf-8")).not.toContain("make deploy");
  });

  it("generates fully English output with lang en", async () => {
    await runCli(tmpDir, { skipLlm: true, lang: "en" });
    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8");
    expect(claudeMd).toContain("Generated by agent-rules-init");
    expect(claudeMd).not.toMatch(/Proyecto|Comandos del repo|Ejecuta los tests|Generado por/);
  });

  it("reports every file as skipped (never error) when re-run on the same repo", async () => {
    await runCli(tmpDir, { skipLlm: true });
    const secondRun = await runCli(tmpDir, { skipLlm: true });

    expect(secondRun.length).toBeGreaterThan(0);
    expect(secondRun.every((r) => r.status === "skipped")).toBe(true);
    expect(secondRun.filter((r) => r.status === "error")).toEqual([]);
  });

  it("does not drop prompt files when two packs are detected in the same repo", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.3.0" },
        devDependencies: { vitest: "^2.1.0" },
        scripts: { test: "vitest run" },
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, "requirements.txt"),
      "fastapi==0.115.0\npytest==8.3.0"
    );
    fs.writeFileSync(path.join(tmpDir, "tox.ini"), "[tox]\nenvlist = py311\n");
    const results = await runCli(tmpDir, { skipLlm: true });
    const errors = results.filter((r) => r.status === "error");
    expect(errors).toEqual([]);
    expect(
      results.find((r) => r.path === ".claude/commands/js-ts-review.generated.md")?.status
    ).toBe("written");
    expect(
      results.find((r) => r.path === ".claude/commands/python-review.generated.md")?.status
    ).toBe("written");
  });

  it("exposes repo facts through onFacts", async () => {
    let facts: RepoFacts | undefined;
    await runCli(expressFixturePath, {
      dryRun: true, nonInteractive: true, skipLlm: true, lang: "en",
      onFacts: (f) => { facts = f; },
    });
    expect(facts?.canonical.some((c) => c.kind === "test" && c.command === "npm test")).toBe(true);
  });
});
