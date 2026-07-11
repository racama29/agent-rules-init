import type { Lang } from "./i18n.js";

export type JsPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageJsonManifest {
  name?: string;
  main?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  moduleType: "module" | "commonjs";
  /** Gestor aplicable al manifiesto, declarado en packageManager o inferido por el lock más cercano. */
  packageManager?: JsPackageManager;
}

export interface LocatedPackageJsonManifest extends PackageJsonManifest {
  path: string;
}

export interface ComposerJsonManifest {
  require: Record<string, string>;
  requireDev: Record<string, string>;
  // Valores string u array en composer.json; se tipan como unknown y se aplanan al extraer.
  scripts?: Record<string, unknown>;
}

export interface RepoSignals {
  rootPath: string;
  files: string[];
  hasFile: (relativePath: string) => boolean;
  hasDir: (relativeDir: string) => boolean;
  packageJson?: PackageJsonManifest;
  packageJsons?: LocatedPackageJsonManifest[];
  pyprojectToml?: string;
  requirementsTxt?: string;
  environmentYml?: string;
  pomXml?: string;
  buildGradle?: string;
  composerJson?: ComposerJsonManifest;
  gemfile?: string;
  goMod?: string;
  cargoToml?: string;
  csproj?: string;
  packageSwift?: string;
  pubspecYaml?: string;
  cmakeLists?: string;
  makefile?: string;
  mixExs?: string;
  buildSbt?: string;
  rDescription?: string;
  renvLock?: string;
  toxIni?: string;
  githubWorkflows?: { path: string; content: string }[];
}

export type Confidence = "high" | "low";

export interface DetectionField<T> {
  value: T;
  confidence: Confidence;
}

export interface DetectionResult {
  packId: string;
  language: string;
  framework?: DetectionField<string>;
  packageManager?: DetectionField<string>;
  testRunner?: DetectionField<string>;
  linter?: DetectionField<string>;
  /** Framework implementado por el propio repositorio; no implica una dependencia. */
  frameworkSource?: string;
  usesTypeScript?: boolean;
  moduleFormat?: "module" | "commonjs";
}

export interface RuleSet {
  summary: string;
  conventions: string[];
  architectureNotes: string[];
}

export interface PromptTemplate {
  id: "review" | "refactor" | "testing";
  title: string;
  body: string;
}

export type CommandSource = JsPackageManager | "composer" | "make" | "mix" | "tox";

export interface CommandEntry {
  source: CommandSource;
  invocation: string; // "pnpm test", "composer lint", "make docs", "mix setup", "tox -e py311"
  detail?: string; // cuerpo del script cuando es legible (JS/composer)
  manifestPath?: string; // manifiesto concreto cuando hay varios (p. ej. un workspace npm)
}

export interface DirEntry {
  dir: string; // "src/"
  note?: string; // solo si el significado del directorio es inequívoco
}

export interface CiCommand {
  command: string;
  workflow: string; // nombre de archivo, p. ej. "ci.yml"
}

export interface CanonicalCommand {
  kind: "test" | "lint" | "build" | "format" | "typecheck";
  command: string;
  /** Archivo o señal del que procede el comando, p. ej. `package.json`, `ci: ci.yml`, `mvnw`. */
  source: string;
  confidence: Confidence;
  /** "." para la raíz del repo; ruta del workspace para unidades anidadas. */
  scope: string;
}

export interface RepoFacts {
  commands: CommandEntry[];
  omittedCommands: { source: CommandSource; count: number }[];
  structure: DirEntry[];
  ciCommands: CiCommand[];
  omittedCiCount: number;
  canonical: CanonicalCommand[];
  testDirs: string[];
  entrypoints: { label: string; target: string; source: string }[];
}

export interface PackContext {
  facts: RepoFacts;
  /** Señales del mismo alcance que facts; permite evitar canónicos de otro stack. */
  signals?: RepoSignals;
}

export interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult, lang: Lang, ctx?: PackContext): RuleSet;
  promptTemplates(detection: DetectionResult, lang: Lang, ctx?: PackContext): PromptTemplate[];
}
