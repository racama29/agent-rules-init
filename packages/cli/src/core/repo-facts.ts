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
