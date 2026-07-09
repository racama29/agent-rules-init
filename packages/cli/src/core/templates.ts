import type { DetectionResult, PromptTemplate, RuleSet } from "./types.js";

export interface RenderEntry {
  detection: DetectionResult;
  ruleSet: RuleSet;
}

function renderSection(entries: RenderEntry[]): string {
  return entries
    .map(({ detection, ruleSet }) => {
      const conventions = ruleSet.conventions.map((c) => `- ${c}`).join("\n");
      const architecture = ruleSet.architectureNotes.map((a) => `- ${a}`).join("\n");
      return [
        `## ${detection.language} (${detection.packId})`,
        "",
        ruleSet.summary,
        "",
        "### Convenciones",
        conventions,
        "",
        "### Arquitectura",
        architecture,
      ].join("\n");
    })
    .join("\n\n");
}

export function renderClaudeMd(entries: RenderEntry[]): string {
  return [
    "# CLAUDE.md",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderAgentsMd(entries: RenderEntry[]): string {
  return [
    "# AGENTS.md",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderCopilotInstructions(entries: RenderEntry[]): string {
  return [
    "# Copilot Instructions",
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
  ].join("\n");
}

export function renderPromptFiles(templates: PromptTemplate[]): { path: string; content: string }[] {
  return templates.flatMap((template) => [
    {
      path: `.claude/commands/${template.id}.generated.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
    {
      path: `.github/prompts/${template.id}.generated.prompt.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
  ]);
}
