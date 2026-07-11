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
  [/^(?:\.[\\/])?mvnw(?:\.cmd)?\b.*\b(?:verify|test)\b/, "test"],
  [/^(?:\.[\\/])?mvnw(?:\.cmd)?\b.*\bpackage\b/, "build"],
  [/^(?:\.[\\/])?gradlew(?:\.bat)?\b.*\b(?:check|test)\b/, "test"],
  [/^(?:\.[\\/])?gradlew(?:\.bat)?\b.*\b(?:build|assemble)\b/, "build"],
  [/^uv run\b.*\b(?:pytest|tox(?:\s+run)?)\b/, "test"],
  [/^poetry run\b.*\b(?:pytest|tox)\b/, "test"],
  [/^pytest\b/, "test"],
  [/^tox(?:\s+run)?\b/, "test"],
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
    const unixWrapper = signals.hasFile("mvnw");
    const windowsWrapper = !unixWrapper && signals.hasFile("mvnw.cmd");
    const hasWrapper = unixWrapper || windowsWrapper;
    out.push({
      kind: "test",
      command: unixWrapper ? "./mvnw test" : windowsWrapper ? "mvnw.cmd test" : "mvn test",
      source: unixWrapper ? "mvnw" : windowsWrapper ? "mvnw.cmd" : "pom.xml",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  } else if (signals.buildGradle) {
    const unixWrapper = signals.hasFile("gradlew");
    const windowsWrapper = !unixWrapper && signals.hasFile("gradlew.bat");
    const hasWrapper = unixWrapper || windowsWrapper;
    out.push({
      kind: "test",
      command: unixWrapper ? "./gradlew test" : windowsWrapper ? "gradlew.bat test" : "gradle test",
      source: unixWrapper ? "gradlew" : windowsWrapper ? "gradlew.bat" : "build.gradle",
      confidence: hasWrapper ? "high" : "low",
      scope: ".",
    });
  }

  const pythonManifest = signals.pyprojectToml ?? signals.requirementsTxt ?? signals.environmentYml;
  const hasPytest = pythonManifest !== undefined && /\bpytest\b/i.test(pythonManifest);
  if (signals.toxIni) {
    out.push({ kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." });
  } else if (hasPytest && signals.hasFile("uv.lock")) {
    // El lock demuestra el gestor, no que pytest pertenezca a un grupo instalado por defecto.
    out.push({ kind: "test", command: "uv run pytest", source: "uv.lock", confidence: "low", scope: "." });
  } else if (hasPytest && signals.hasFile("poetry.lock")) {
    out.push({ kind: "test", command: "poetry run pytest", source: "poetry.lock", confidence: "low", scope: "." });
  } else if (hasPytest) {
    const source = signals.pyprojectToml
      ? "pyproject.toml"
      : signals.requirementsTxt
      ? "requirements.txt"
      : "environment.yml";
    out.push({ kind: "test", command: "pytest", source, confidence: "low", scope: "." });
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
  kind: CanonicalCommand["kind"],
  family?: "js-ts" | "python" | "java"
): CanonicalCommand | undefined {
  if (family && ctx?.signals) {
    return selectCanonicalForFamily({ ...ctx, signals: ctx.signals }, family).find(
      (c) => c.kind === kind && c.confidence === "high"
    );
  }
  return ctx?.facts.canonical.find((c) => c.kind === kind && c.confidence === "high");
}

function selectCanonicalForFamily(
  ctx: PackContext & { signals: RepoSignals },
  family: "js-ts" | "python" | "java"
): CanonicalCommand[] {
  const jsSources = new Set<CommandSource>(["npm", "pnpm", "yarn", "bun"]);
  const commands = ctx.facts.commands.filter((command) =>
    family === "js-ts" ? jsSources.has(command.source) : family === "python" ? command.source === "tox" : false
  );
  const ciCommands = ctx.facts.ciCommands.filter(({ command }) => {
    if (family === "js-ts") return /^(?:npm|pnpm|yarn|bun)\b/.test(command);
    if (family === "python") return /^(?:uv|poetry|pytest|tox)\b/.test(command);
    return /^(?:\.[\\/])?(?:mvnw(?:\.cmd)?|gradlew(?:\.bat)?)\b|^(?:mvn|gradle)\b/.test(command);
  });
  const signals: RepoSignals = {
    ...ctx.signals,
    packageJson: family === "js-ts" ? ctx.signals.packageJson : undefined,
    packageJsons: family === "js-ts" ? ctx.signals.packageJsons : undefined,
    pyprojectToml: family === "python" ? ctx.signals.pyprojectToml : undefined,
    requirementsTxt: family === "python" ? ctx.signals.requirementsTxt : undefined,
    environmentYml: family === "python" ? ctx.signals.environmentYml : undefined,
    toxIni: family === "python" ? ctx.signals.toxIni : undefined,
    pomXml: family === "java" ? ctx.signals.pomXml : undefined,
    buildGradle: family === "java" ? ctx.signals.buildGradle : undefined,
  };
  return selectCanonicalCommands(signals, commands, ciCommands);
}
