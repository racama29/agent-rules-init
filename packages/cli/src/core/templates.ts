import type { CommandSource, DetectionResult, PromptTemplate, RepoFacts, RuleSet } from "./types.js";

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

const SOURCE_FILES: Record<CommandSource, string> = {
  npm: "package.json",
  composer: "composer.json",
  make: "Makefile",
  mix: "mix.exs",
  tox: "tox.ini",
};

export function renderRepoFacts(facts: RepoFacts): string {
  const sections: string[] = [];
  if (facts.commands.length > 0) {
    const lines = facts.commands.map((c) =>
      c.detail && c.detail !== c.invocation
        ? `- \`${c.invocation}\` → \`${c.detail}\` (${SOURCE_FILES[c.source]})`
        : `- \`${c.invocation}\` (${SOURCE_FILES[c.source]})`
    );
    for (const o of facts.omittedCommands) lines.push(`- …y ${o.count} más en ${SOURCE_FILES[o.source]}`);
    sections.push(["## Comandos del repo", "", ...lines].join("\n"));
  }
  if (facts.structure.length > 0) {
    const lines = facts.structure.map((d) => (d.note ? `- \`${d.dir}\` — ${d.note}` : `- \`${d.dir}\``));
    sections.push(["## Estructura", "", ...lines].join("\n"));
  }
  if (facts.ciCommands.length > 0) {
    const lines = facts.ciCommands.map((c) => `- \`${c.command}\` (${c.workflow})`);
    if (facts.omittedCiCount > 0) lines.push(`- …y ${facts.omittedCiCount} más`);
    sections.push(["## Lo que ejecuta CI (GitHub Actions)", "", ...lines].join("\n"));
  }
  return sections.join("\n\n");
}

function renderDocument(title: string, entries: RenderEntry[], facts?: RepoFacts): string {
  const factsBlock = facts ? renderRepoFacts(facts) : "";
  return [
    title,
    "",
    "Generado por agent-rules-init a partir de lo detectado en este repo.",
    "",
    renderSection(entries),
    ...(factsBlock ? ["", factsBlock] : []),
  ].join("\n");
}

export function renderClaudeMd(entries: RenderEntry[], facts?: RepoFacts): string {
  return renderDocument("# CLAUDE.md", entries, facts);
}

export function renderAgentsMd(entries: RenderEntry[], facts?: RepoFacts): string {
  return renderDocument("# AGENTS.md", entries, facts);
}

export function renderCopilotInstructions(entries: RenderEntry[], facts?: RepoFacts): string {
  return renderDocument("# Copilot Instructions", entries, facts);
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
