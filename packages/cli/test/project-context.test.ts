import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadContextFile,
  loadTaskContext,
  makeProjectContext,
  normalizeMaintainerText,
  saveMaintainerIntent,
  saveTaskContext,
  splitMaintainerList,
  validateMaintainerIntent,
  validateTaskContext,
} from "../src/core/project-context.js";
import type { RepoFacts } from "../src/core/types.js";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-context-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const facts: RepoFacts = {
  commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0,
  canonical: [], testDirs: [], entrypoints: [], architectureFacts: [], conventionFacts: [],
};

describe("project context", () => {
  it("normalizes maintainer text and bounded semicolon-separated lists", () => {
    expect(normalizeMaintainerText("  hello\n## injected  ")).toBe("hello ## injected");
    expect(splitMaintainerList("one; two\nthree")).toEqual(["one", "two", "three"]);
  });

  it("validates durable intent with safe defaults", () => {
    const warnings: string[] = [];
    const intent = validateMaintainerIntent({
      purpose: "Keep releases predictable for library users.",
      priorities: ["correctness", "compatibility", "maintenance", "ignored"],
      autonomy: "unknown",
      boundaries: ["Do not change the public API."],
    }, warnings);
    expect(intent).toMatchObject({
      purpose: "Keep releases predictable for library users.",
      priorities: ["correctness", "compatibility", "maintenance"],
      autonomy: "plan-first",
    });
    expect(warnings).toHaveLength(2);
  });

  it("validates a task without treating it as repository evidence", () => {
    const warnings: string[] = [];
    expect(validateTaskContext({ goal: "Reduce startup time.", fallback: "ask" }, warnings)).toEqual({
      goal: "Reduce startup time.", successCriteria: [], allowedPaths: [], fallback: "ask", restrictions: [],
    });
  });

  it("preserves existing config fields while saving maintainer intent", () => {
    fs.writeFileSync(path.join(root, ".agent-rules-init.yml"), "lang: es\n# keep this\nnoAi: true\n");
    saveMaintainerIntent(root, {
      purpose: "Generate reliable project guidance.", priorities: ["correctness"],
      assistantRoles: ["review"], autonomy: "plan-first", boundaries: [], doneCriteria: [], decisions: [],
    });
    const saved = fs.readFileSync(path.join(root, ".agent-rules-init.yml"), "utf8");
    expect(saved).toContain("lang: es");
    expect(saved).toContain("# keep this");
    expect(saved).toContain("purpose: Generate reliable project guidance.");
  });

  it("saves and reloads local task context", () => {
    saveTaskContext(root, {
      goal: "Improve startup.", successCriteria: ["Below 100 ms"], allowedPaths: ["packages/cli/**"],
      fallback: "conservative", restrictions: ["No dependencies"],
    });
    expect(loadTaskContext(root)).toMatchObject({ task: { goal: "Improve startup." }, warnings: [] });
  });

  it("loads portable context files and composes the common model", () => {
    const file = path.join(root, "context.yml");
    fs.writeFileSync(file, "intent:\n  purpose: Help maintainers.\ntask:\n  goal: Improve docs.\n");
    const loaded = loadContextFile(file);
    expect(makeProjectContext(facts, {}, loaded.task, loaded.intent)).toMatchObject({
      facts, intent: { purpose: "Help maintainers." }, task: { goal: "Improve docs." },
    });
  });
});
