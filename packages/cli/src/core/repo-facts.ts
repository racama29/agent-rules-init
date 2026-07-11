import path from "node:path";
import { parse } from "yaml";
import { UI, type Lang } from "./i18n.js";
import { selectCanonicalCommands } from "./canonical-commands.js";
import type {
  CiCommand,
  CommandEntry,
  CommandSource,
  DirEntry,
  JsPackageManager,
  RepoFacts,
  RepoSignals,
} from "./types.js";

const NPM_DIRECT_LIFECYCLE = new Set(["test", "start", "stop", "restart"]);

export function extractJsPackageCommands(signals: RepoSignals): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const locatedManifests = signals.packageJsons ?? [];
  const hasLocatedManifests = locatedManifests.length > 0;
  const manifests = hasLocatedManifests
    ? locatedManifests
    : signals.packageJson
    ? [{ ...signals.packageJson, path: "package.json" }]
    : [];
  for (const manifest of manifests) {
    const packageDir = path.posix.dirname(manifest.path);
    const manager = manifest.packageManager ?? signals.packageJson?.packageManager ?? "npm";
    for (const [name, body] of Object.entries(manifest.scripts)) {
      if (typeof body !== "string" || body.trim() === "") continue;
      entries.push({
        source: manager,
        invocation: jsScriptInvocation(manager, packageDir, name),
        detail: body.trim(),
        ...(hasLocatedManifests ? { manifestPath: manifest.path } : {}),
      });
    }
  }
  return entries;
}

/** @deprecated Conservado como alias de API; también devuelve comandos pnpm/Yarn/Bun. */
export const extractNpmCommands = extractJsPackageCommands;

function jsScriptInvocation(manager: JsPackageManager, packageDir: string, script: string): string {
  const name = quoteShellArg(script);
  if (manager === "npm") {
    const prefix = packageDir === "." ? "npm" : `npm --prefix ${quoteShellArg(packageDir)}`;
    return NPM_DIRECT_LIFECYCLE.has(script) ? `${prefix} ${name}` : `${prefix} run ${name}`;
  }
  if (manager === "pnpm") {
    const prefix = packageDir === "." ? "pnpm" : `pnpm --dir ${quoteShellArg(packageDir)}`;
    return NPM_DIRECT_LIFECYCLE.has(script) ? `${prefix} ${name}` : `${prefix} run ${name}`;
  }
  if (manager === "yarn") {
    const prefix = packageDir === "." ? "yarn" : `yarn --cwd ${quoteShellArg(packageDir)}`;
    return `${prefix} run ${name}`;
  }
  const prefix = packageDir === "." ? "bun" : `bun --cwd ${quoteShellArg(packageDir)}`;
  return `${prefix} run ${name}`;
}

function quoteShellArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

export function extractMakeTargets(signals: RepoSignals): CommandEntry[] {
  const makefile = signals.makefile;
  if (!makefile) return [];
  const targets = new Set<string>();
  for (const line of makefile.split(/\r?\n/)) {
    // Un target va a inicio de línea (las recetas van indentadas con tab) y su nombre
    // no lleva %, ni empieza por "." (targets especiales tipo .PHONY). El (?!=) evita
    // asignaciones ":=". La clase de caracteres ya excluye espacios, con lo que
    // "CFLAGS :=", los comentarios "#" y las URLs en comentarios tampoco matchean.
    const match = /^([A-Za-z0-9_/-][A-Za-z0-9_./-]*)\s*:(?!=)/.exec(line);
    if (!match) continue;
    targets.add(match[1]);
  }
  return [...targets].map((target) => ({ source: "make" as const, invocation: `make ${target}` }));
}

export function extractMixAliases(signals: RepoSignals): CommandEntry[] {
  const mixExs = signals.mixExs;
  if (!mixExs) return [];
  // Cuerpo de la función aliases (defp aliases do ... end). Si no existe con esa
  // forma, no se emite nada — omitir antes que inventar.
  const fnMatch = mixExs.match(/defp?\s+aliases\s*(?:\(\))?\s*do([\s\S]*?)\n\s*end/);
  if (!fnMatch) return [];
  const body = fnMatch[1];
  const names = new Set<string>();
  // Claves del keyword list cuyo valor empieza por lista o string: `setup: [...]`,
  // `"ecto.setup": [...]`. Un alias con valor función (&fun/1) se omite.
  for (const match of body.matchAll(/(?:"([^"]+)"|([a-z_][a-zA-Z0-9_.]*)):\s*(?=[["'])/g)) {
    names.add(match[1] ?? match[2]);
  }
  return [...names].map((alias) => ({ source: "mix" as const, invocation: `mix ${alias}` }));
}

export function extractToxEnvs(signals: RepoSignals): CommandEntry[] {
  const toxIni = signals.toxIni;
  if (!toxIni) return [];
  const match = toxIni.match(/^[ \t]*env_?list\s*=\s*(.+(?:\n[ \t]+\S.*)*)/m);
  if (!match) return [];
  const envs = match[1]
    .split(/[,\s]+/)
    .map((env) => env.trim())
    // Los envs con factores generadores (py3{10,11}) se omiten en vez de expandirlos.
    // El split por comas los parte en trozos ("py3{10", "11}"), así que basta con
    // descartar cualquier trozo que contenga una llave.
    .filter((env) => env !== "" && !env.startsWith("#") && !/[{}]/.test(env));
  return [...new Set(envs)].map((env) => ({ source: "tox" as const, invocation: `tox -e ${env}` }));
}

export function extractComposerCommands(signals: RepoSignals): CommandEntry[] {
  const scripts = signals.composerJson?.scripts ?? {};
  const entries: CommandEntry[] = [];
  for (const [name, raw] of Object.entries(scripts)) {
    const parts = Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === "string")
      : typeof raw === "string"
      ? [raw]
      : [];
    if (parts.length === 0) continue;
    entries.push({ source: "composer", invocation: `composer ${name}`, detail: parts.join(" && ") });
  }
  return entries;
}

const WELL_KNOWN_NAMES = new Set([
  "test", "tests", "build", "lint", "fmt", "format", "check", "dev", "start",
  "typecheck", "ci", "coverage", "e2e", "unit", "docs", "clean", "install",
  "setup", "release", "watch", "fix", "all",
]);
const MAX_COMMANDS_PER_SOURCE = 15;

function invocationName(entry: CommandEntry): string {
  const parts = entry.invocation.split(" ");
  return parts[parts.length - 1];
}

export function filterCommands(entries: CommandEntry[]): {
  kept: CommandEntry[];
  omitted: { source: CommandSource; count: number }[];
} {
  const kept: CommandEntry[] = [];
  const omitted: { source: CommandSource; count: number }[] = [];
  const sources = [...new Set(entries.map((e) => e.source))];
  for (const source of sources) {
    const group = entries.filter((e) => e.source === source);
    const wellKnown = group.filter((e) => WELL_KNOWN_NAMES.has(invocationName(e)));
    const rest = group.filter((e) => !WELL_KNOWN_NAMES.has(invocationName(e)));
    const keptGroup = new Set([...wellKnown, ...rest].slice(0, MAX_COMMANDS_PER_SOURCE));
    // Se emite en el orden original del manifiesto, no con los conocidos primero.
    kept.push(...group.filter((e) => keptGroup.has(e)));
    const omittedCount = group.length - keptGroup.size;
    if (omittedCount > 0) omitted.push({ source, count: omittedCount });
  }
  return { kept, omitted };
}

const MAX_CI_COMMANDS = 30;

// Líneas de un script multilínea que son control de flujo del shell, no comandos:
// `if [[ ... ]]; then`, `else`, `fi`, `for x in ...; do`, `done`, `case`/`esac`...
const SHELL_CONTROL_FLOW = /^(?:if|elif|else|fi|then|do|done|for|while|until|case|esac)\b|^(?:fi|then|else|done|esac)$/;

function isShellControlFlow(line: string): boolean {
  return SHELL_CONTROL_FLOW.test(line);
}

export function extractCiCommands(signals: RepoSignals): { commands: CiCommand[]; omittedCount: number } {
  const seen = new Map<string, string>(); // comando -> workflow de origen
  for (const workflow of signals.githubWorkflows ?? []) {
    let doc: unknown;
    try {
      doc = parse(workflow.content);
    } catch {
      continue; // YAML inválido: omitir antes que inventar
    }
    if (!doc || typeof doc !== "object") continue;
    const jobs = (doc as Record<string, unknown>).jobs;
    if (!jobs || typeof jobs !== "object") continue;
    const workflowName = workflow.path.split("/").pop() ?? workflow.path;
    for (const job of Object.values(jobs as Record<string, unknown>)) {
      if (!job || typeof job !== "object") continue;
      const steps = (job as Record<string, unknown>).steps;
      if (!Array.isArray(steps)) continue;
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const run = (step as Record<string, unknown>).run;
        if (typeof run !== "string") continue;
        for (const rawLine of run.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (line === "" || line.startsWith("#") || isShellControlFlow(line)) continue;
          if (!seen.has(line)) seen.set(line, workflowName);
        }
      }
    }
  }
  const all = [...seen.entries()].map(([command, workflow]) => ({ command, workflow }));
  return {
    commands: all.slice(0, MAX_CI_COMMANDS),
    omittedCount: Math.max(0, all.length - MAX_CI_COMMANDS),
  };
}

const MAX_DIRS = 20;

export function extractStructure(signals: RepoSignals, lang: Lang): DirEntry[] {
  const dirNotes = UI[lang].dirNotes;
  const dirs = new Set<string>();
  for (const file of signals.files) {
    const normalized = file.split(path.sep).join("/");
    const slash = normalized.indexOf("/");
    if (slash > 0) dirs.add(normalized.slice(0, slash));
  }
  return [...dirs]
    .sort()
    .slice(0, MAX_DIRS)
    .map((dir) => {
      const note = dirNotes[dir.toLowerCase()];
      return note ? { dir: `${dir}/`, note } : { dir: `${dir}/` };
    });
}

export function buildRepoFacts(signals: RepoSignals, lang: Lang): RepoFacts {
  const allCommands = [
    ...extractJsPackageCommands(signals),
    ...extractComposerCommands(signals),
    ...extractMakeTargets(signals),
    ...extractMixAliases(signals),
    ...extractToxEnvs(signals),
  ];
  const { kept, omitted } = filterCommands(allCommands);
  const { commands: ciCommands, omittedCount: omittedCiCount } = extractCiCommands(signals);
  return {
    commands: kept,
    omittedCommands: omitted,
    structure: extractStructure(signals, lang),
    ciCommands,
    omittedCiCount,
    canonical: selectCanonicalCommands(signals, kept, ciCommands),
  };
}
