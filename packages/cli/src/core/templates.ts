import { UI, type Lang } from "./i18n.js";
import type { DetectionResult, PromptTemplate, RepoFacts, RuleSet } from "./types.js";
import { SOURCE_FILES } from "./canonical-commands.js";

export interface RenderEntry {
  detection: DetectionResult;
  ruleSet: RuleSet;
}

function renderSection(entries: RenderEntry[], lang: Lang): string {
  const ui = UI[lang];
  return entries
    .map(({ detection, ruleSet }) => {
      const conventions = ruleSet.conventions.map((c) => `- ${c}`).join("\n");
      const architecture = ruleSet.architectureNotes.map((a) => `- ${a}`).join("\n");
      return [
        `## ${detection.language} (${detection.packId})`,
        "",
        ruleSet.summary,
        "",
        `### ${ui.sections.conventions}`,
        conventions,
        "",
        `### ${ui.sections.architecture}`,
        architecture,
      ].join("\n");
    })
    .join("\n\n");
}

export function renderRepoFacts(facts: RepoFacts, lang: Lang): string {
  const ui = UI[lang];
  const sections: string[] = [];
  const canonical = facts.canonical.filter((c) => c.confidence === "high");
  if (canonical.length > 0) {
    const lines = canonical.map((c) => `- ${c.kind}: \`${c.command}\` (${c.source})`);
    sections.push([`## ${ui.sections.canonical}`, "", ...lines].join("\n"));
  }
  if (facts.commands.length > 0) {
    const lines = facts.commands.map((c) => {
      const sourceFile = c.manifestPath ?? SOURCE_FILES[c.source];
      return c.detail && c.detail !== c.invocation
        ? `- \`${c.invocation}\` → \`${c.detail}\` (${sourceFile})`
        : `- \`${c.invocation}\` (${sourceFile})`;
    });
    for (const o of facts.omittedCommands) lines.push(`- ${ui.andMore(o.count, SOURCE_FILES[o.source])}`);
    sections.push([`## ${ui.sections.commands}`, "", ...lines].join("\n"));
  }
  if (facts.structure.length > 0) {
    const lines = facts.structure.map((d) => (d.note ? `- \`${d.dir}\` — ${d.note}` : `- \`${d.dir}\``));
    sections.push([`## ${ui.sections.structure}`, "", ...lines].join("\n"));
  }
  if (facts.ciCommands.length > 0) {
    const lines = facts.ciCommands.map((c) => `- \`${c.command}\` (${c.workflow})`);
    if (facts.omittedCiCount > 0) lines.push(`- ${ui.andMore(facts.omittedCiCount)}`);
    sections.push([`## ${ui.sections.ci}`, "", ...lines].join("\n"));
  }
  return sections.join("\n\n");
}

function renderDocument(title: string, entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const factsBlock = facts ? renderRepoFacts(facts, lang) : "";
  return [
    title,
    "",
    UI[lang].generatedHeader,
    "",
    renderSection(entries, lang),
    ...(factsBlock ? ["", factsBlock] : []),
  ].join("\n");
}

export function renderClaudeMd(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  return renderDocument("# CLAUDE.md", entries, facts, lang);
}

export function renderAgentsMd(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  return renderDocument("# AGENTS.md", entries, facts, lang);
}

export function renderCopilotInstructions(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  return renderDocument("# Copilot Instructions", entries, facts, lang);
}

export function renderPromptFiles(
  packId: string,
  templates: PromptTemplate[]
): { path: string; content: string }[] {
  return templates.flatMap((template) => [
    {
      path: `.claude/commands/${packId}-${template.id}.generated.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
    {
      path: `.github/prompts/${packId}-${template.id}.generated.prompt.md`,
      content: `# ${template.title}\n\n${template.body}\n`,
    },
  ]);
}
