import type { CommandEntry, RepoSignals } from "./types.js";

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
