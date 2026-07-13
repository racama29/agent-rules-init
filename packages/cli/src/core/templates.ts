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
  options: {
    summaries?: boolean;
    defaults?: boolean;
    operationalConventions?: boolean;
    architectureDefaults?: boolean;
  } = {}
): string {
  const ui = UI[lang];
  const { summaries = true } = options;
  const seenDefaults = new Set<string>();
  const unique = (items: readonly string[], seen: Set<string>, limit: number) => items
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  return entries
    .map(({ detection, ruleSet }) => {
      const conventionItems = options.operationalConventions === false
        ? ruleSet.conventions.filter((item) => !/^(?:Run the tests|Run the repository|Ejecuta los tests|Ejecuta la suite)/i.test(item))
        : ruleSet.conventions;
      // Pack-authored advice is useful context but is not repository evidence. Keep a
      // small, explicitly labeled default section and reserve observed sections for
      // high-confidence facts with cited paths.
      const defaults = unique(
        [
          ...conventionItems,
          ...(options.architectureDefaults === false ? [] : ruleSet.architectureNotes),
        ],
        seenDefaults,
        2
      ).map((item) => `- ${item}`).join("\n");
      const parts = [
        `## ${detection.language} (${detection.packId})`,
      ];
      if (summaries) parts.push("", ruleSet.summary);
      if (options.defaults !== false && defaults) parts.push("", `### ${ui.sections.defaults}`, defaults);
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
    renderSection(entries, lang),
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
    renderSection(entries, lang),
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
    renderSection(entries, lang, { operationalConventions: false, architectureDefaults: false }),
  ];
  if (facts) {
    const conventions = renderEvidenceSection(localConventionsTitle(lang), facts.conventionFacts ?? [], lang);
    const architecture = renderEvidenceSection(architectureFactsTitle(lang), facts.architectureFacts ?? [], lang);
    for (const block of [conventions, architecture]) if (block) blocks.push("", block);
  }
  return blocks.join("\n");
}

export function renderCursorRules(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const intro = lang === "es"
    ? "Reglas breves que Cursor debe aplicar siempre al editar este repositorio."
    : "Concise rules Cursor should always apply while editing this repository.";
  const blocks = [
    "---",
    "description: Repository-specific conventions and validation commands",
    "alwaysApply: true",
    "---",
    "",
    "# Repository rules", "", UI[lang].generatedHeader, "", intro, "",
    renderSection(entries, lang, { summaries: false, architectureDefaults: false }),
  ];
  if (facts) {
    const canonical = renderCanonical(facts, lang);
    const conventions = renderEvidenceSection(localConventionsTitle(lang), facts.conventionFacts ?? [], lang);
    for (const block of [canonical, conventions]) if (block) blocks.push("", block);
  }
  return blocks.join("\n");
}

export function renderGeminiMd(entries: RenderEntry[], facts: RepoFacts | undefined, lang: Lang): string {
  const intro = lang === "es"
    ? "Contexto de proyecto para investigar, implementar y verificar cambios con Gemini CLI."
    : "Project context for investigating, implementing and verifying changes with Gemini CLI.";
  const factsBlock = facts ? renderRepoFacts(facts, lang) : "";
  return [
    "# GEMINI.md", "", UI[lang].generatedHeader, "", intro, "",
    renderSection(entries, lang, { operationalConventions: false }),
    ...(factsBlock ? ["", factsBlock] : []),
  ].join("\n");
}

export function renderPromptFiles(
  packId: string,
  templates: PromptTemplate[],
  facts: RepoFacts,
  lang: Lang
): { path: string; content: string }[] {
  const canonical = facts.canonical.filter((item) => item.confidence === "high");
  const architecture = (facts.architectureFacts ?? []).filter((item) => item.confidence === "high");
  const conventions = (facts.conventionFacts ?? []).filter((item) => item.confidence === "high");
  const relevant = templates.filter((template) => {
    if (template.id === "testing") return canonical.some((item) => item.kind === "test");
    if (template.id === "refactor") return architecture.length > 0;
    return canonical.length > 0 || conventions.length > 0;
  });
  const contextLines = [
    ...canonical.slice(0, 3).map((item) => `- ${item.kind}: \`${item.command}\` (${item.source})`),
    ...architecture.slice(0, 2).map((item) => `- ${item.statement} (${evidenceLabel(lang)}: ${item.evidence.map((path) => `\`${path}\``).join(", ")})`),
    ...conventions.slice(0, 2).map((item) => `- ${item.statement} (${evidenceLabel(lang)}: ${item.evidence.map((path) => `\`${path}\``).join(", ")})`),
  ];
  const context = [
    lang === "es" ? "## Contexto verificado del repositorio" : "## Verified repository context",
    "",
    ...contextLines,
  ].join("\n");
  return relevant.flatMap((template) => [
    {
      path: `.claude/commands/${packId}-${template.id}.generated.md`,
      content: `# ${template.title}\n\n${context}\n\n${template.body}\n`,
    },
    {
      path: `.github/prompts/${packId}-${template.id}.generated.prompt.md`,
      content: `# ${template.title}\n\n${context}\n\n${template.body}\n`,
    },
  ]);
}
