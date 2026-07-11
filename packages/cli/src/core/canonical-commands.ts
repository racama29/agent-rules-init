import type {
  CanonicalCommand,
  CiCommand,
  CommandEntry,
  CommandSource,
  RepoSignals,
} from "./types.js";

export const SOURCE_FILES: Record<CommandSource, string> = {
  npm: "package.json",
  pnpm: "package.json",
  yarn: "package.json",
  bun: "package.json",
  composer: "composer.json",
  make: "Makefile",
  mix: "mix.exs",
  tox: "tox.ini",
};

const KIND_ORDER: CanonicalCommand["kind"][] = ["test", "lint", "build", "format", "typecheck"];

// Nombre de script → kind. Solo nombres inequívocos; "check" o "ci" quedan fuera a propósito.
const SCRIPT_KINDS: Record<string, CanonicalCommand["kind"]> = {
  test: "test",
  lint: "lint",
  build: "build",
  format: "format",
  fmt: "format",
  typecheck: "typecheck",
  "type-check": "typecheck",
};

function scriptName(entry: CommandEntry): string {
  const parts = entry.invocation.split(" ");
  return parts[parts.length - 1];
}

function isRootManifest(entry: CommandEntry): boolean {
  return entry.manifestPath === undefined || entry.manifestPath === "package.json";
}

function fromScripts(commands: CommandEntry[]): CanonicalCommand[] {
  const found: CanonicalCommand[] = [];
  for (const entry of commands) {
    if (!isRootManifest(entry)) continue;
    const kind = SCRIPT_KINDS[scriptName(entry)];
    if (!kind || found.some((c) => c.kind === kind)) continue;
    found.push({
      kind,
      command: entry.invocation,
      source: entry.manifestPath ?? SOURCE_FILES[entry.source],
      confidence: "high",
      scope: ".",
    });
  }
  return found;
}

// El comando de CI se conserva textual (evidencia), solo se clasifica su kind.
const CI_PATTERNS: [RegExp, CanonicalCommand["kind"]][] = [
  [/^(?:npm|pnpm|yarn|bun)(?: run)? test\b/, "test"],
  [/^(?:npm|pnpm|yarn|bun) run lint\b/, "lint"],
  [/^(?:npm|pnpm|yarn|bun) run build\b/, "build"],
  [/^(?:npm|pnpm|yarn|bun) run (?:format|fmt)\b/, "format"],
  [/^(?:npm|pnpm|yarn|bun) run (?:typecheck|type-check)\b/, "typecheck"],
  [/^\.[\\/]mvnw\b.*\b(?:verify|test)\b/, "test"],
  [/^\.[\\/]mvnw\b.*\bpackage\b/, "build"],
  [/^\.[\\/]gradlew\b.*\b(?:check|test)\b/, "test"],
  [/^\.[\\/]gradlew\b.*\b(?:build|assemble)\b/, "build"],
  [/^(?:uv run |poetry run )?pytest\b/, "test"],
  [/^tox\b/, "test"],
  [/^cargo test\b/, "test"],
  [/^go test\b/, "test"],
];

function fromCi(ciCommands: CiCommand[]): CanonicalCommand[] {
  const found: CanonicalCommand[] = [];
  for (const ci of ciCommands) {
    for (const [pattern, kind] of CI_PATTERNS) {
      if (!pattern.test(ci.command)) continue;
      if (found.some((c) => c.kind === kind)) break;
      found.push({
        kind,
        command: ci.command,
        source: `ci: ${ci.workflow}`,
        confidence: "high",
        scope: ".",
      });
      break;
    }
  }
  return found;
}

export function selectCanonicalCommands(
  signals: RepoSignals,
  commands: CommandEntry[],
  ciCommands: CiCommand[]
): CanonicalCommand[] {
  const byKind = new Map<CanonicalCommand["kind"], CanonicalCommand>();
  for (const candidate of [...fromScripts(commands), ...fromCi(ciCommands)]) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, candidate);
  }
  return KIND_ORDER.flatMap((kind) => byKind.get(kind) ?? []);
}
