import path from "node:path";
import type { CommandEntry, CommandSource, DirEntry, RepoSignals } from "./types.js";

const NPM_DIRECT_LIFECYCLE = new Set(["test", "start", "stop", "restart"]);

export function extractNpmCommands(signals: RepoSignals): CommandEntry[] {
  const scripts = signals.packageJson?.scripts ?? {};
  const entries: CommandEntry[] = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string" || body.trim() === "") continue;
    entries.push({
      source: "npm",
      invocation: NPM_DIRECT_LIFECYCLE.has(name) ? `npm ${name}` : `npm run ${name}`,
      detail: body.trim(),
    });
  }
  return entries;
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

const DIR_NOTES: Record<string, string> = {
  src: "código fuente",
  lib: "código fuente",
  tests: "tests",
  test: "tests",
  spec: "tests",
  __tests__: "tests",
  docs: "documentación",
  doc: "documentación",
  examples: "ejemplos",
  scripts: "scripts auxiliares",
  tools: "herramientas auxiliares",
  migrations: "migraciones de base de datos",
  benchmarks: "benchmarks",
  ".github": "workflows y configuración de GitHub",
  public: "activos públicos",
  static: "activos estáticos",
  assets: "activos",
  config: "configuración",
};
const MAX_DIRS = 20;

export function extractStructure(signals: RepoSignals): DirEntry[] {
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
      const note = DIR_NOTES[dir.toLowerCase()];
      return note ? { dir: `${dir}/`, note } : { dir: `${dir}/` };
    });
}
