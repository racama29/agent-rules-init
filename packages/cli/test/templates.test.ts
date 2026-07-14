import { describe, it, expect } from "vitest";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderCursorRules,
  renderGeminiMd,
  renderPromptFiles,
  renderRepoFacts,
} from "../src/core/templates.js";
import type { DetectionResult, RuleSet, PromptTemplate, RepoFacts } from "../src/core/types.js";

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

const facts: RepoFacts = {
  commands: [
    { source: "npm", invocation: "npm test", detail: "vitest run --coverage" },
    { source: "make", invocation: "make docs" },
  ],
  omittedCommands: [{ source: "npm", count: 4 }],
  structure: [{ dir: "src/", note: "código fuente" }, { dir: "weirddir/" }],
  ciCommands: [{ command: "npm ci", workflow: "ci.yml" }],
  omittedCiCount: 0,
  canonical: [],
  testDirs: [],
  entrypoints: [],
  architectureFacts: [],
  conventionFacts: [],
};

const emptyFacts: RepoFacts = {
  commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0, canonical: [],
  testDirs: [], entrypoints: [], architectureFacts: [], conventionFacts: [],
};

describe("templates", () => {
  it("renders CLAUDE.md including each pack's summary and conventions", () => {
    const content = renderClaudeMd(entries, undefined, "es");
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
    expect(content).toContain("Usa TypeScript estricto.");
  });

  it("renders AGENTS.md with the same rule content", () => {
    const content = renderAgentsMd(entries, undefined, "es");
    expect(content).toContain("Mantén los componentes pequeños.");
  });

  it("renders copilot-instructions with the same rule content", () => {
    const content = renderCopilotInstructions(entries, undefined, "es");
    expect(content).toContain("Proyecto JavaScript/TypeScript con react.");
  });

  it("renders an always-applied Cursor MDC rule", () => {
    const content = renderCursorRules(entries, undefined, "en");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("# Repository rules");
    expect(content).toContain("Stack defaults");
  });

  it("renders Gemini CLI project context", () => {
    const content = renderGeminiMd(entries, undefined, "en");
    expect(content).toContain("# GEMINI.md");
    expect(content).toContain("Project context for investigating");
    expect(content).toContain("react");
  });

  it("renders genuinely different documents for each consumer", () => {
    const intelligentFacts: RepoFacts = {
      ...facts,
      canonical: [{ kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." }],
      architectureFacts: [{
        kind: "source-layout", statement: "Primary source code lives under src/.",
        evidence: ["src/index.ts"], scope: ".", confidence: "high",
      }],
      conventionFacts: [{
        kind: "typescript", statement: "TypeScript strict mode is enabled.",
        evidence: ["tsconfig.json"], scope: ".", confidence: "high",
      }],
    };
    const claude = renderClaudeMd(entries, { facts: intelligentFacts }, "en");
    const agents = renderAgentsMd(entries, { facts: intelligentFacts }, "en");
    const copilot = renderCopilotInstructions(entries, { facts: intelligentFacts }, "en");
    const cursor = renderCursorRules(entries, { facts: intelligentFacts }, "en");
    const gemini = renderGeminiMd(entries, { facts: intelligentFacts }, "en");
    expect(new Set([claude, agents, copilot, cursor, gemini])).toHaveLength(5);
    expect(claude).toContain("What CI runs");
    expect(agents).toContain("Operational rules");
    expect(agents).toContain("npm test");
    expect(copilot).toContain("TypeScript strict mode is enabled");
    expect(copilot).not.toContain("What CI runs");
    expect(copilot).not.toContain("Repo commands");
    expect(copilot).not.toContain("npm test");
    expect(copilot).not.toContain("Mantén los componentes pequeños.");
  });

  it("renders provenance next to observed architecture and local conventions", () => {
    const withEvidence: RepoFacts = {
      ...emptyFacts,
      architectureFacts: [{
        kind: "tests", statement: "Tests are placed under test/.", evidence: ["test/app.test.js"],
        scope: ".", confidence: "high",
      }],
      conventionFacts: [{
        kind: "formatting", statement: "Indentation uses spaces with size 2.", evidence: [".editorconfig"],
        scope: ".", confidence: "high",
      }],
    };
    const output = renderClaudeMd(entries, { facts: withEvidence }, "en");
    expect(output).toContain("## Observed architecture");
    expect(output).toContain("evidence: `test/app.test.js`");
    expect(output).toContain("## Verified local conventions");
    expect(output).toContain("evidence: `.editorconfig`");
  });

  it("renders one file per prompt template with claude and vscode paths, namespaced by packId", () => {
    const templates: PromptTemplate[] = [{ id: "review", title: "Code Review (JS/TS)", body: "Revisa el diff." }];
    const promptFacts = {
      ...emptyFacts,
      canonical: [{ kind: "test" as const, command: "npm test", source: "package.json", confidence: "high" as const, scope: "." }],
    };
    const files = renderPromptFiles("js-ts", templates, { facts: promptFacts }, "en");
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".claude/commands/js-ts-review.generated.md",
      ".github/prompts/js-ts-review.generated.prompt.md",
    ]);
    expect(files[0].content).toContain("Revisa el diff.");
    expect(files[0].content).toContain("npm test");
    expect(files[0].content).toContain("package.json");
  });

  it("renders the repo facts sections with per-line source attribution", () => {
    const output = renderRepoFacts(facts, "es");
    expect(output).toContain("## Comandos del repo");
    expect(output).toContain("- `npm test` → `vitest run --coverage` (package.json)");
    expect(output).toContain("- `make docs` (Makefile)");
    expect(output).toContain("…y 4 más en package.json");
    expect(output).toContain("## Estructura");
    expect(output).toContain("- `src/` — código fuente");
    expect(output).toContain("- `weirddir/`");
    expect(output).toContain("## Lo que ejecuta CI (GitHub Actions)");
    expect(output).toContain("- `npm ci` (ci.yml)");
  });

  it("omits every empty facts section and returns empty string for empty facts", () => {
    expect(renderRepoFacts(emptyFacts, "es")).toBe("");
    const onlyStructure = { ...emptyFacts, structure: [{ dir: "src/" }] };
    const output = renderRepoFacts(onlyStructure, "es");
    expect(output).toContain("## Estructura");
    expect(output).not.toContain("## Comandos del repo");
    expect(output).not.toContain("## Lo que ejecuta CI");
  });

  it("appends the facts sections after the stack sections in CLAUDE.md", () => {
    const output = renderClaudeMd(entries, { facts }, "es");
    expect(output.indexOf("## Comandos del repo")).toBeGreaterThan(output.indexOf("### Defaults del stack"));
  });

  it("keeps empty Claude facts stable and omits raw command catalogs from concise consumers", () => {
    expect(renderClaudeMd(entries, undefined, "es")).toBe(renderClaudeMd(entries, { facts: emptyFacts }, "es"));
    expect(renderClaudeMd(entries, { facts }, "es")).toContain("## Comandos del repo");
    expect(renderAgentsMd(entries, { facts }, "es")).not.toContain("## Comandos del repo");
    expect(renderCopilotInstructions(entries, { facts }, "es")).not.toContain("## Comandos del repo");
  });

  it("renders facts section titles and header in English", () => {
    const output = renderClaudeMd(entries, { facts }, "en");
    expect(output).toContain("Generated by agent-rules-init");
    expect(output).toContain("### Stack defaults");
    expect(output).not.toContain("### Architecture");
    expect(output).not.toContain("### Defaults del stack");
    expect(output).toContain("## Repo commands");
    expect(output).toContain("## Structure");
    expect(output).toContain("## What CI runs (GitHub Actions)");
    expect(output).toContain("…and 4 more in package.json");
    expect(output).not.toContain("Comandos del repo");
    expect(output).not.toContain("Generado por");
  });

  it("labels pack advice as stack defaults and caps it at two items", () => {
    const output = renderClaudeMd(entries, { facts }, "en");
    const defaults = output.split("### Stack defaults\n")[1].split("\n## ")[0];
    expect(defaults.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
    expect(output).not.toContain("### Architecture");
  });

  it("renders a canonical commands section with provenance, high confidence only", () => {
    const facts: RepoFacts = {
      commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0,
      testDirs: [], entrypoints: [], architectureFacts: [], conventionFacts: [],
      canonical: [
        { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
        { kind: "build", command: "gradle build", source: "build.gradle", confidence: "low", scope: "." },
      ],
    };
    const output = renderRepoFacts(facts, "en");
    expect(output).toContain("## Canonical commands");
    expect(output).toContain("- test: `npm test` (package.json)");
    expect(output).not.toContain("gradle build");
  });

  it("does not collide when two different packs render the same template id", () => {
    const templates: PromptTemplate[] = [{ id: "review", title: "Code Review", body: "body" }];
    const promptFacts = {
      ...emptyFacts,
      canonical: [{ kind: "test" as const, command: "npm test", source: "package.json", confidence: "high" as const, scope: "." }],
    };
    const jsFiles = renderPromptFiles("js-ts", templates, { facts: promptFacts }, "en");
    const pyFiles = renderPromptFiles("python", templates, { facts: promptFacts }, "en");
    const jsPaths = new Set(jsFiles.map((f) => f.path));
    const pyPaths = new Set(pyFiles.map((f) => f.path));
    for (const path of pyPaths) {
      expect(jsPaths.has(path)).toBe(false);
    }
  });

  it("omits generic prompts when the repository provides no supporting evidence", () => {
    const templates: PromptTemplate[] = [
      { id: "review", title: "Review", body: "Review changes." },
      { id: "refactor", title: "Refactor", body: "Refactor code." },
      { id: "testing", title: "Testing", body: "Add tests." },
    ];
    expect(renderPromptFiles("js-ts", templates, { facts: emptyFacts }, "en")).toEqual([]);
  });

  it("keeps maintainer intent separate from observed evidence and adapts detail per consumer", () => {
    const context = {
      facts: emptyFacts,
      intent: {
        purpose: "Keep releases predictable",
        priorities: ["stability", "speed"],
        assistantRoles: ["implementation"],
        autonomy: "plan-first" as const,
        boundaries: ["Do not change the public API"],
        doneCriteria: ["All checks pass"],
        decisions: ["Node 18 remains supported"],
      },
      task: {
        goal: "Reduce startup time",
        successCriteria: ["Starts under 100 ms"],
        allowedPaths: ["packages/cli"],
        fallback: "ask" as const,
        restrictions: ["No new runtime dependencies"],
      },
    };
    const claude = renderClaudeMd(entries, context, "en");
    const copilot = renderCopilotInstructions(entries, context, "en");
    expect(claude).toContain("## Maintainer-provided project intent");
    expect(claude).toContain("## Current task provided by the maintainer");
    expect(claude).toContain("Node 18 remains supported");
    expect(claude).not.toContain("evidence: Keep releases predictable");
    expect(copilot).toContain("Keep releases predictable");
    expect(copilot).not.toContain("Node 18 remains supported");
    expect(copilot).not.toContain("Starts under 100 ms");
  });

  it("creates contextual prompts without inventing repository evidence", () => {
    const templates: PromptTemplate[] = [
      { id: "review", title: "Review", body: "Review changes." },
      { id: "testing", title: "Testing", body: "Add tests." },
    ];
    const files = renderPromptFiles("js-ts", templates, {
      facts: emptyFacts,
      task: {
        goal: "Review the release path",
        successCriteria: ["No regressions"],
        allowedPaths: [],
        fallback: "ask",
        restrictions: [],
      },
    }, "en");
    expect(files).toHaveLength(4);
    expect(files[0].content).toContain("Current task provided by the maintainer");
    expect(files[0].content).not.toContain("Verified repository context");
  });
});
