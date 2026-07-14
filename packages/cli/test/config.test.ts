import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/core/config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-config-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: string, filename = ".agent-rules-init.yml"): string {
  const configPath = path.join(tmpDir, filename);
  fs.writeFileSync(configPath, content);
  return configPath;
}

describe("loadConfig", () => {
  it("returns an empty config when neither supported filename exists", () => {
    expect(loadConfig(tmpDir)).toEqual({ config: {}, warnings: [] });
  });

  it("loads all supported settings from .yml", () => {
    const configPath = writeConfig(`
lang: es
exclude:
  - legacy/**
  - examples/**
noAi: true
assistant: codex
model: gpt-5.5
enrichCache: false
enrichTimeoutSeconds: 90
enrichRetries: 0
projects:
  apps/web:
    framework: react
    testRunner: vitest
    linter: eslint
    packageManager: pnpm
`);

    expect(loadConfig(tmpDir)).toEqual({
      sourcePath: configPath,
      warnings: [],
      config: {
        lang: "es",
        exclude: ["legacy/**", "examples/**"],
        noAi: true,
        assistant: "codex",
        model: "gpt-5.5",
        enrichCache: false,
        enrichTimeoutSeconds: 90,
        enrichRetries: 0,
        projects: {
          "apps/web": {
            framework: "react",
            testRunner: "vitest",
            linter: "eslint",
            packageManager: "pnpm",
          },
        },
      },
    });
  });

  it("also loads the .yaml filename", () => {
    const configPath = writeConfig("lang: en\n", ".agent-rules-init.yaml");
    expect(loadConfig(tmpDir)).toEqual({ config: { lang: "en" }, sourcePath: configPath, warnings: [] });
  });

  it("uses .yml deterministically and warns when both files exist", () => {
    const preferred = writeConfig("lang: es\n");
    writeConfig("lang: en\n", ".agent-rules-init.yaml");
    const result = loadConfig(tmpDir);
    expect(result.config.lang).toBe("es");
    expect(result.sourcePath).toBe(preferred);
    expect(result.warnings[0]).toContain("takes precedence");
  });

  it("ignores malformed and unknown fields with actionable warnings", () => {
    writeConfig(`
lang: fr
exclude: legacy/**
noAi: yes
enrich: yes
assistant: cursor
model: ""
enrichCache: yes
enrichTimeoutSeconds: 5
enrichRetries: 3
typo: true
projects:
  apps/web:
    framework: ""
    testRunner: vitest
    extra: value
  apps/api: express
`);

    const result = loadConfig(tmpDir);
    expect(result.config).toEqual({ projects: { "apps/web": { testRunner: "vitest" } } });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"lang"'),
        expect.stringContaining('"exclude"'),
        expect.stringContaining('"noAi"'),
        expect.stringContaining('"enrich"'),
        expect.stringContaining('"assistant"'),
        expect.stringContaining('"model"'),
        expect.stringContaining('"enrichCache"'),
        expect.stringContaining('"enrichTimeoutSeconds"'),
        expect.stringContaining('"enrichRetries"'),
        expect.stringContaining('"typo"'),
        expect.stringContaining('"projects.apps/web.framework"'),
        expect.stringContaining('"projects.apps/web.extra"'),
        expect.stringContaining('"projects.apps/api"'),
      ])
    );
  });

  it("filters invalid exclude entries without dropping valid ones", () => {
    writeConfig("exclude:\n  - src/**\n  - 42\n  - ''\n");
    const result = loadConfig(tmpDir);
    expect(result.config.exclude).toEqual(["src/**"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("accepts an empty YAML document", () => {
    const configPath = writeConfig("");
    expect(loadConfig(tmpDir)).toEqual({ config: {}, sourcePath: configPath, warnings: [] });
  });

  it("loads validated maintainer intent from project configuration", () => {
    writeConfig(`
intent:
  purpose: Keep releases stable for CLI users
  priorities: [correctness, compatibility]
  assistantRoles: [implementation, testing]
  autonomy: plan-first
  boundaries: [Do not break the public API]
  doneCriteria: [All checks pass]
  decisions: [Node 18 remains supported]
`);
    expect(loadConfig(tmpDir).config.intent).toEqual({
      purpose: "Keep releases stable for CLI users",
      priorities: ["correctness", "compatibility"],
      assistantRoles: ["implementation", "testing"],
      autonomy: "plan-first",
      boundaries: ["Do not break the public API"],
      doneCriteria: ["All checks pass"],
      decisions: ["Node 18 remains supported"],
    });
  });

  it("rejects malformed maintainer intent without accepting partial policy", () => {
    writeConfig(`
intent:
  purpose: 42
  priorities: correctness
  autonomy: unlimited
`);
    const result = loadConfig(tmpDir);
    expect(result.config.intent).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringContaining("intent.purpose")]);
  });

  it("accepts scanner budgets and rejects unsafe values", () => {
    writeConfig("scanMaxDepth: 20\nscanMaxFiles: 250000\n");
    expect(loadConfig(tmpDir).config).toMatchObject({ scanMaxDepth: 20, scanMaxFiles: 250000 });

    writeConfig("scanMaxDepth: 0\nscanMaxFiles: 10\n", ".agent-rules-init.yaml");
    fs.rmSync(path.join(tmpDir, ".agent-rules-init.yml"));
    const invalid = loadConfig(tmpDir);
    expect(invalid.config).toEqual({});
    expect(invalid.warnings).toHaveLength(2);
  });

  it("throws ConfigError with the source path for invalid YAML", () => {
    const configPath = writeConfig("projects: [unterminated\n");
    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
    expect(() => loadConfig(tmpDir)).toThrow(`Invalid YAML in ${configPath}`);
  });

  it("rejects a non-object YAML root clearly", () => {
    const configPath = writeConfig("- one\n- two\n");
    expect(() => loadConfig(tmpDir)).toThrow(`Invalid configuration in ${configPath}`);
  });
});
