import { buildRepoFacts } from "./repo-facts.js";
import { renderAgentsMd } from "./templates.js";
import type { DetectionResult } from "./types.js";
import type { Lang } from "./i18n.js";
import type { ProjectUnit } from "./project-units.js";
import { jsTsPack } from "../packs/js-ts.js";

export interface ProjectOverrides {
  framework?: string;
  testRunner?: string;
  linter?: string;
  packageManager?: string;
}

function applyOverrides(detection: DetectionResult, overrides: ProjectOverrides): DetectionResult {
  const updated = { ...detection };
  for (const field of ["framework", "testRunner", "linter", "packageManager"] as const) {
    const value = overrides[field];
    if (value) updated[field] = { value, confidence: "high" };
  }
  return updated;
}

/** Generates the path-scoped AGENTS file for one JS/TS package. */
export function renderProjectUnitAgents(
  unit: ProjectUnit,
  lang: Lang,
  overrides: ProjectOverrides = {}
): { path: string; content: string } | null {
  const rawDetection = jsTsPack.detect(unit.signals);
  if (!rawDetection) return null;
  const detection = applyOverrides(rawDetection, overrides);
  const facts = buildRepoFacts(unit.signals, lang);
  const ruleSet = jsTsPack.rules(detection, lang, { facts });
  return {
    path: `${unit.path}/AGENTS.generated.md`,
    content: renderAgentsMd([{ detection, ruleSet }], facts, lang),
  };
}
