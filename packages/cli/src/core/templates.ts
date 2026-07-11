import { UI, type Lang } from "./i18n.js";
import type { DetectionResult, EvidenceFact, PromptTemplate, RepoFacts, RuleSet } from "./types.js";
import { SOURCE_FILES } from "./canonical-commands.js";

export interface RenderEntry {
  detection: DetectionResult;
  ruleSet: RuleSet;
}

function renderSection(
  entries: RenderEntry[],
  lang: Lang,
  options: { summaries?: boolean; conventions?: boolean; architecture?: boolean; operationalConventions?: boolean } = {}
): string {
  const ui = UI[lang];
  const { summaries = true } = options;
  return entries
    .map(({ detection, ruleSet }) => {
      const conventionItems = options.operationalConventions === false
        ? ruleSet.conventions.filter((item) => !/^(?:Run the tests|Run the repository|Ejecuta los tests|Ejecuta la suite)/i.test(item))
        : ruleSet.conventions;
      const conventions = conventionItems.map((c) => `- ${c}`).join("\n");
      const architecture = ruleSet.architectureNotes.map((a) => `- ${a}`).join("\n");
      const parts = [
        `## ${detection.language} (${detection.packId})`,
      ];
      if (summaries) parts.push("", ruleSet.summary);
      if (options.conventions !== false && conventions) parts.push("", `### ${ui.sections.conventions}`, conventions);
      if (options.architecture !== false && architecture) parts.push("", `### ${ui.sections.architecture}`, architecture);
      return parts.join("\n");
    })
    .join("\n\n");
}

function evidenceLabel(lang: Lang): string {
  return lang === "es" ? "evidencia" : "evidence";
}

function renderEvidenceSection(title: string, facts: readonly EvidenceFact[], lang: Lang): string {
  const high = facts.filter((fact) => fact.confidence === "high");
  if (high.length === 0) return "";
  const lines = high.map((fact) => `- ${fact.statement} (${evidenceLabel(lang)}: ${fact.evidence.map((item) => `\`${item}\``).join(", ")})`);
  return [`## ${title}`, "", ...lines].join("\n");
}

function architectureFactsTitle(lang: Lang): string {
  return lang === "es" ? "Arquitectura observada" : "Observed architecture";
}

function localConventionsTitle(lang: Lang): string {
  return lang === "es" ? "Convenciones locales verificadas" : "Verified local conventions";
}

function renderCanonical(facts: RepoFacts, lang: Lang): string {
  const commands = facts.canonical.filter((command) => command.confidence === "high");
  if (commands.length === 0) return "";
  return [
    `## ${UI[lang].sections.canonical}`,
    "",
    ...commands.map((command) => `- ${command.kind}: \`${command.command}\` (${command.source})`),
  ].join("\n");
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
  if (facts.structure.length > 0 || facts.testDirs.length > 0 || facts.entrypoints.length > 0) {
    const lines = facts.structure.map((d) => (d.note ? `- \`${d.dir}\` — ${d.note}` : `- \`${d.dir}\``));
    for (const dir of facts.testDirs) {
      if (!facts.structure.some((d) => d.dir === dir)) lines.push(`- \`${dir}\` — ${ui.testDirNote}`);
    }
    for (const entry of facts.entrypoints) {
      lines.push(`- ${ui.entrypointNote}: \`${entry.target}\` (${entry.source} "${entry.label}")`);
    }
    sections.push([`## ${ui.sections.structure}`, "", ...lines].join("\n"));
  }
  if (facts.ciCommands.length > 0) {
    const lines = facts.ciCommands.map((c) => `- \`${c.command}\` (${c.workflow})`);
    if (facts.omittedCiCount > 0) lines.push(`- ${ui.andMore(facts.omittedCiCount)}`);
    sections.push([`## ${ui.sections.ci}`, "", ...lines].join("\n"));
  }
  const architecture = renderEvidenceSection(architectureFactsTitle(lang), facts.architectureFacts ?? [], lang);
  if (architecture) sections.push(architecture);
  const conventions = renderEvidenceSection(localConventionsTitle(lang), facts.conventionFacts ?? [], lang);
  if (conventions) sections.push(conventions);
  return sections.join("\n\n");
}

function renderDocument(title: string, entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const factsBlock = facts ? renderRepoFacts(facts, lang) : "";
  return [
    title,
    "",
    UI[lang].generatedHeader,
    "",
    renderSection(entries, lang, { architecture: !(facts?.architectureFacts?.length) }),
    ...(factsBlock ? ["", factsBlock] : []),
  ].join("\n");
}

export function renderClaudeMd(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  return renderDocument("# CLAUDE.md", entries, facts, lang);
}

export function renderAgentsMd(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const intro = lang === "es"
    ? "Reglas operativas para modificar este repositorio. Respeta el alcance y valida los cambios con los comandos indicados."
    : "Operational rules for modifying this repository. Respect scope and validate changes with the commands below.";
  const blocks = [
    "# AGENTS.md", "", UI[lang].generatedHeader, "", intro, "",
    renderSection(entries, lang, { architecture: !(facts?.architectureFacts?.length) }),
  ];
  if (facts) {
    const canonical = renderCanonical(facts, lang);
    const architecture = renderEvidenceSection(architectureFactsTitle(lang), facts.architectureFacts ?? [], lang);
    const conventions = renderEvidenceSection(localConventionsTitle(lang), facts.conventionFacts ?? [], lang);
    for (const block of [canonical, architecture, conventions]) if (block) blocks.push("", block);
  }
  return blocks.join("\n");
}

export function renderCopilotInstructions(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const intro = lang === "es"
    ? "Aplica estas convenciones al completar y modificar código. Omite tareas operativas de terminal salvo que sean necesarias para el cambio."
    : "Apply these conventions when completing and modifying code. Omit terminal operations unless the change requires them.";
  const blocks = [
    "# Copilot Instructions", "", UI[lang].generatedHeader, "", intro, "",
    renderSection(entries, lang, { architecture: false, operationalConventions: false }),
  ];
  if (facts) {
    const conventions = renderEvidenceSection(localConventionsTitle(lang), facts.conventionFacts ?? [], lang);
    const architecture = renderEvidenceSection(architectureFactsTitle(lang), facts.architectureFacts ?? [], lang);
    for (const block of [conventions, architecture]) if (block) blocks.push("", block);
  }
  return blocks.join("\n");
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
