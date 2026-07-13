import type { Pack, RepoSignals } from "../core/types.js";

type PackModule = Record<string, Pack>;
type PackLoader = () => Promise<PackModule>;

const LOADERS: Readonly<Record<string, PackLoader>> = {
  "js-ts": () => import("./js-ts.js"),
  python: () => import("./python.js"),
  java: () => import("./java.js"),
  php: () => import("./php.js"),
  ruby: () => import("./ruby.js"),
  go: () => import("./go.js"),
  rust: () => import("./rust.js"),
  csharp: () => import("./csharp.js"),
  kotlin: () => import("./kotlin.js"),
  swift: () => import("./swift.js"),
  dart: () => import("./dart.js"),
  cpp: () => import("./cpp.js"),
  elixir: () => import("./elixir.js"),
  scala: () => import("./scala.js"),
  r: () => import("./r.js"),
};

const cache = new Map<string, Pack>();

function candidateIds(signals: RepoSignals): string[] {
  const ids: string[] = [];
  if (signals.packageJson) ids.push("js-ts");
  if (signals.pyprojectToml || signals.requirementsTxt || signals.environmentYml) ids.push("python");
  if (signals.pomXml || signals.buildGradle) ids.push("java");
  if (signals.composerJson) ids.push("php");
  if (signals.gemfile) ids.push("ruby");
  if (signals.goMod) ids.push("go");
  if (signals.cargoToml) ids.push("rust");
  if (signals.csproj) ids.push("csharp");
  if (signals.buildGradle) ids.push("kotlin");
  if (signals.packageSwift) ids.push("swift");
  if (signals.pubspecYaml) ids.push("dart");
  if (signals.cmakeLists || signals.makefile || signals.files.some((file) => /\.(?:c|cc|cpp|cxx|h|hpp)$/i.test(file))) ids.push("cpp");
  if (signals.mixExs) ids.push("elixir");
  if (signals.buildSbt) ids.push("scala");
  if (signals.rDescription || signals.renvLock) ids.push("r");
  return ids;
}

async function load(id: string): Promise<Pack> {
  const cached = cache.get(id);
  if (cached) return cached;
  const loader = LOADERS[id];
  if (!loader) throw new Error(`Unknown pack: ${id}`);
  const module = await loader();
  const pack = Object.values(module).find((value) => value?.id === id);
  if (!pack) throw new Error(`Pack module did not export ${id}`);
  cache.set(id, pack);
  return pack;
}

/** Loads only packs whose manifests or source extensions exist in this repository. */
export function loadCandidatePacks(signals: RepoSignals): Promise<Pack[]> {
  return Promise.all(candidateIds(signals).map(load));
}

export function findPack(id: string): Promise<Pack> {
  return load(id);
}
