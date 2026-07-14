import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type * as YAML from "yaml";
import type { AgentRulesConfig } from "./config.js";
import type {
  AssistantAutonomy,
  MaintainerIntent,
  ProjectContext,
  RepoFacts,
  TaskContext,
  TaskFallback,
} from "./types.js";

const require = createRequire(import.meta.url);
const TASK_CONTEXT_FILE = ".agent-rules-init/task-context.local.yml";
const MAX_ITEM_LENGTH = 250;
const MAX_PURPOSE_LENGTH = 400;
const MAX_LIST_ITEMS = 10;

function yaml(): typeof YAML {
  return require("yaml") as typeof YAML;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens user input so it cannot inject Markdown sections into generated files. */
export function normalizeMaintainerText(value: string, maxLength = MAX_ITEM_LENGTH): string {
  const printable = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : character;
  }).join("");
  return printable
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function splitMaintainerList(value: string): string[] {
  return value
    .split(/[;\n]+/)
    .map((item) => normalizeMaintainerText(item))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function stringList(value: unknown, location: string, warnings: string[], max = MAX_LIST_ITEMS): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`Configuration key "${location}" must be an array of strings; it was ignored.`);
    return [];
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeMaintainerText(item))
    .filter(Boolean)
    .slice(0, max);
  if (items.length !== value.length || value.length > max) {
    warnings.push(`Configuration key "${location}" contains invalid or excess entries; they were ignored.`);
  }
  return items;
}

function requiredText(value: unknown, location: string, warnings: string[], maxLength: number): string | undefined {
  if (typeof value !== "string") {
    warnings.push(`Configuration key "${location}" must be a non-empty string; it was ignored.`);
    return undefined;
  }
  const normalized = normalizeMaintainerText(value, maxLength);
  if (!normalized) {
    warnings.push(`Configuration key "${location}" must be a non-empty string; it was ignored.`);
    return undefined;
  }
  return normalized;
}

const AUTONOMY = new Set<AssistantAutonomy>(["implement", "plan-first", "propose-only"]);
const FALLBACK = new Set<TaskFallback>(["conservative", "ask", "propose"]);

export function validateMaintainerIntent(
  value: unknown,
  warnings: string[],
  location = "intent"
): MaintainerIntent | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings.push(`Configuration key "${location}" must be an object; it was ignored.`);
    return undefined;
  }
  const purpose = requiredText(value.purpose, `${location}.purpose`, warnings, MAX_PURPOSE_LENGTH);
  if (!purpose) return undefined;
  const autonomy = AUTONOMY.has(value.autonomy as AssistantAutonomy)
    ? value.autonomy as AssistantAutonomy
    : "plan-first";
  if (value.autonomy !== undefined && !AUTONOMY.has(value.autonomy as AssistantAutonomy)) {
    warnings.push(`Configuration key "${location}.autonomy" is invalid; "plan-first" was used.`);
  }
  return {
    purpose,
    priorities: stringList(value.priorities, `${location}.priorities`, warnings, 3),
    assistantRoles: stringList(value.assistantRoles, `${location}.assistantRoles`, warnings),
    autonomy,
    boundaries: stringList(value.boundaries, `${location}.boundaries`, warnings),
    doneCriteria: stringList(value.doneCriteria, `${location}.doneCriteria`, warnings),
    decisions: stringList(value.decisions, `${location}.decisions`, warnings),
  };
}

export function validateTaskContext(
  value: unknown,
  warnings: string[],
  location = "task"
): TaskContext | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings.push(`Context key "${location}" must be an object; it was ignored.`);
    return undefined;
  }
  const goal = requiredText(value.goal, `${location}.goal`, warnings, MAX_PURPOSE_LENGTH);
  if (!goal) return undefined;
  const fallback = FALLBACK.has(value.fallback as TaskFallback)
    ? value.fallback as TaskFallback
    : "conservative";
  if (value.fallback !== undefined && !FALLBACK.has(value.fallback as TaskFallback)) {
    warnings.push(`Context key "${location}.fallback" is invalid; "conservative" was used.`);
  }
  return {
    goal,
    successCriteria: stringList(value.successCriteria, `${location}.successCriteria`, warnings),
    allowedPaths: stringList(value.allowedPaths, `${location}.allowedPaths`, warnings),
    fallback,
    restrictions: stringList(value.restrictions, `${location}.restrictions`, warnings),
  };
}

export function makeProjectContext(
  facts: RepoFacts,
  config: AgentRulesConfig,
  task?: TaskContext,
  overrideIntent?: MaintainerIntent
): ProjectContext {
  return { facts, intent: overrideIntent ?? config.intent, task };
}

export function loadTaskContext(rootPath: string): { task?: TaskContext; warnings: string[] } {
  const taskPath = path.join(rootPath, TASK_CONTEXT_FILE);
  if (!fs.existsSync(taskPath)) return { warnings: [] };
  const warnings: string[] = [];
  try {
    const parsed = yaml().parse(fs.readFileSync(taskPath, "utf8")) as unknown;
    const raw = isRecord(parsed) && "task" in parsed ? parsed.task : parsed;
    return { task: validateTaskContext(raw, warnings), warnings };
  } catch (error) {
    warnings.push(`Could not read ${TASK_CONTEXT_FILE}: ${(error as Error).message}`);
    return { warnings };
  }
}

export function loadContextFile(filePath: string): {
  intent?: MaintainerIntent;
  task?: TaskContext;
  warnings: string[];
} {
  const warnings: string[] = [];
  const parsed = yaml().parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Context file ${filePath} must contain a YAML object.`);
  return {
    intent: validateMaintainerIntent(parsed.intent, warnings),
    task: validateTaskContext(parsed.task, warnings),
    warnings,
  };
}

export function saveMaintainerIntent(rootPath: string, intent: MaintainerIntent): string {
  const yml = path.join(rootPath, ".agent-rules-init.yml");
  const yamlPath = path.join(rootPath, ".agent-rules-init.yaml");
  const target = fs.existsSync(yml) ? yml : fs.existsSync(yamlPath) ? yamlPath : yml;
  const document = yaml().parseDocument(fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "{}");
  document.set("intent", intent);
  fs.writeFileSync(target, document.toString(), "utf8");
  return target;
}

export function saveTaskContext(rootPath: string, task: TaskContext): string {
  const target = path.join(rootPath, TASK_CONTEXT_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, yaml().stringify({ task }), "utf8");
  return target;
}

export function taskContextRelativePath(): string {
  return TASK_CONTEXT_FILE;
}
