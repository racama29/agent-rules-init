import type {
  CanonicalCommand,
  CiCommand,
  CommandEntry,
  CommandSource,
  PackContext,
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

function fromSignals(signals: RepoSignals): CanonicalCommand[] {
  const out: CanonicalCommand[] = [];

  if (signals.pomXml) {
    const hasWrapper = signals.hasFile("mvnw") || signals.hasFile("mvnw.cmd");
    out.push({
      kind: "test",
      command: hasWrapper ? "./mvnw test" : "mvn test",
      source: hasWrapper ? "mvnw" : "pom.xml",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  } else if (signals.buildGradle) {
    const hasWrapper = signals.hasFile("gradlew") || signals.hasFile("gradlew.bat");
    out.push({
      kind: "test",
      command: hasWrapper ? "./gradlew test" : "gradle test",
      source: hasWrapper ? "gradlew" : "build.gradle",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  }

  const pythonManifest = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  const hasPytest = pythonManifest !== undefined && /\bpytest\b/i.test(pythonManifest);
  if (hasPytest && signals.hasFile("uv.lock")) {
    out.push({ kind: "test", command: "uv run pytest", source: "uv.lock", confidence: "high", scope: "." });
  } else if (hasPytest && signals.hasFile("poetry.lock")) {
    out.push({ kind: "test", command: "poetry run pytest", source: "poetry.lock", confidence: "high", scope: "." });
  } else if (signals.toxIni) {
    out.push({ kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." });
  } else if (hasPytest) {
    out.push({ kind: "test", command: "pytest", source: "pyproject.toml", confidence: "low", scope: "." });
  }

  return out;
}

export function selectCanonicalCommands(
  signals: RepoSignals,
  commands: CommandEntry[],
  ciCommands: CiCommand[]
): CanonicalCommand[] {
  const byKind = new Map<CanonicalCommand["kind"], CanonicalCommand>();
  for (const candidate of [...fromScripts(commands), ...fromCi(ciCommands), ...fromSignals(signals)]) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, candidate);
  }
  return KIND_ORDER.flatMap((kind) => byKind.get(kind) ?? []);
}

export function canonicalOf(
  ctx: PackContext | undefined,
  kind: CanonicalCommand["kind"]
): CanonicalCommand | undefined {
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}
