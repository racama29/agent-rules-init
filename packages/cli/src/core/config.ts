import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Lang } from "./i18n.js";

const CONFIG_FILENAMES = [".agent-rules-init.yml", ".agent-rules-init.yaml"] as const;
const ROOT_KEYS = new Set(["lang", "exclude", "projects", "noAi"]);
const PROJECT_KEYS = ["framework", "testRunner", "linter", "packageManager"] as const;
const PROJECT_KEY_SET: ReadonlySet<string> = new Set(PROJECT_KEYS);

export interface ProjectConfig {
  framework?: string;
  testRunner?: string;
  linter?: string;
  packageManager?: string;
}

export interface AgentRulesConfig {
  lang?: Lang;
  exclude?: string[];
  projects?: Record<string, ProjectConfig>;
  noAi?: boolean;
}

export interface LoadedConfig {
  config: AgentRulesConfig;
  /** Absolute path to the selected config file, if one exists. */
  sourcePath?: string;
  warnings: string[];
}

export class ConfigError extends Error {
  readonly configPath: string;

  constructor(message: string, configPath: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
    this.configPath = configPath;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeyWarnings(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown configuration key \"${location}${key}\"; it was ignored.`);
}

function optionalNonEmptyString(
  value: unknown,
  location: string,
  warnings: string[]
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    warnings.push(`Configuration key \"${location}\" must be a non-empty string; it was ignored.`);
    return undefined;
  }
  return value.trim();
}

function validateProjects(value: unknown, warnings: string[]): Record<string, ProjectConfig> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings.push('Configuration key "projects" must be an object keyed by project path; it was ignored.');
    return undefined;
  }

  const projects: Record<string, ProjectConfig> = {};
  for (const [projectPath, rawProject] of Object.entries(value)) {
    if (projectPath.trim().length === 0) {
      warnings.push("A project path must not be empty; that project was ignored.");
      continue;
    }
    if (!isRecord(rawProject)) {
      warnings.push(`Configuration key \"projects.${projectPath}\" must be an object; it was ignored.`);
      continue;
    }

    warnings.push(...unknownKeyWarnings(rawProject, PROJECT_KEY_SET, `projects.${projectPath}.`));
    const project: ProjectConfig = {};
    for (const key of PROJECT_KEYS) {
      const parsed = optionalNonEmptyString(rawProject[key], `projects.${projectPath}.${key}`, warnings);
      if (parsed !== undefined) project[key] = parsed;
    }
    projects[projectPath] = project;
  }
  return projects;
}

function validateConfig(value: unknown, configPath: string, warnings: string[]): AgentRulesConfig {
  // An empty YAML document is equivalent to an empty configuration.
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) {
    throw new ConfigError(`Invalid configuration in ${configPath}: the YAML root must be an object.`, configPath);
  }

  warnings.push(...unknownKeyWarnings(value, ROOT_KEYS, ""));
  const config: AgentRulesConfig = {};

  if (value.lang !== undefined) {
    if (value.lang === "es" || value.lang === "en") config.lang = value.lang;
    else warnings.push('Configuration key "lang" must be "es" or "en"; it was ignored.');
  }

  if (value.exclude !== undefined) {
    if (!Array.isArray(value.exclude)) {
      warnings.push('Configuration key "exclude" must be an array of strings; it was ignored.');
    } else {
      const exclude = value.exclude.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      );
      if (exclude.length !== value.exclude.length) {
        warnings.push('Configuration key "exclude" contains non-string or empty entries; they were ignored.');
      }
      config.exclude = exclude.map((entry) => entry.trim());
    }
  }

  const projects = validateProjects(value.projects, warnings);
  if (projects !== undefined) config.projects = projects;

  if (value.noAi !== undefined) {
    if (typeof value.noAi === "boolean") config.noAi = value.noAi;
    else warnings.push('Configuration key "noAi" must be a boolean; it was ignored.');
  }

  return config;
}

/** Loads and validates the optional repository-local agent-rules configuration. */
export function loadConfig(rootPath: string): LoadedConfig {
  const found = CONFIG_FILENAMES.map((filename) => path.resolve(rootPath, filename)).filter((candidate) =>
    fs.existsSync(candidate)
  );
  if (found.length === 0) return { config: {}, warnings: [] };

  const sourcePath = found[0];
  const warnings: string[] = [];
  if (found.length > 1) {
    warnings.push(
      `Both ${CONFIG_FILENAMES.join(" and ")} exist; ${path.basename(sourcePath)} takes precedence.`
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read configuration file ${sourcePath}.`, sourcePath, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new ConfigError(`Invalid YAML in ${sourcePath}.${detail}`, sourcePath, { cause: error });
  }

  return { config: validateConfig(parsed, sourcePath, warnings), sourcePath, warnings };
}
