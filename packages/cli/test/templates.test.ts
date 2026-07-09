import { describe, it, expect } from "vitest";
import { renderClaudeMd, renderAgentsMd, renderCopilotInstructions, renderPromptFiles } from "../src/core/templates.js";
import type { DetectionResult, RuleSet, PromptTemplate } from "../src/core/types.js";

const detection: DetectionResult = {
  packId: "js-ts",
  language: "TypeScript/JavaScript",
  framework: { value: "react", confidence: "high" },
};
const ruleSet: RuleSet = {
  summary: "Proyecto JavaScript/TypeScript con react.",
  conventions: ["Usa TypeScript estricto."],
  architectureNotes: ["Mantén los componentes pequeños."],
};
const entries = [{ detection, ruleSet }];

describe("templates", () => {
  it("renders CLAUDE.md including each pack's summary and conventions", () => {
    const content = renderClaudeMd(entries);
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
    expect(content).toContain("Usa TypeScript estricto.");
  });

  it("renders AGENTS.md with the same rule content", () => {
    const content = renderAgentsMd(entries);
    expect(content).toContain("Mantén los componentes pequeños.");
  });

  it("renders copilot-instructions with the same rule content", () => {
    const content = renderCopilotInstructions(entries);
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
  });

  it("renders one file per prompt template with claude and vscode paths, namespaced by packId", () => {
    const templates: PromptTemplate[] = [{ id: "review", title: "Code Review (JS/TS)", body: "Revisa el diff." }];
    const files = renderPromptFiles("js-ts", templates);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".claude/commands/js-ts-review.generated.md",
      ".github/prompts/js-ts-review.generated.prompt.md",
    ]);
    expect(files[0].content).toContain("Revisa el diff.");
  });

  it("does not collide when two different packs render the same template id", () => {
    const templates: PromptTemplate[] = [{ id: "review", title: "Code Review", body: "body" }];
    const jsFiles = renderPromptFiles("js-ts", templates);
    const pyFiles = renderPromptFiles("python", templates);
    const jsPaths = new Set(jsFiles.map((f) => f.path));
    const pyPaths = new Set(pyFiles.map((f) => f.path));
    for (const path of pyPaths) {
      expect(jsPaths.has(path)).toBe(false);
    }
  });
});
