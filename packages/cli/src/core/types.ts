export interface PackageJsonManifest {
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  moduleType: "module" | "commonjs";
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

export type CommandSource = "npm" | "composer" | "make" | "mix" | "tox";

export interface CommandEntry {
  source: CommandSource;
  invocation: string; // "npm test", "composer lint", "make docs", "mix setup", "tox -e py311"
  detail?: string; // cuerpo del script cuando es legible (npm/composer)
}

export interface DirEntry {
  dir: string; // "src/"
  note?: string; // solo si el significado del directorio es inequívoco
}

export interface CiCommand {
  command: string;
  workflow: string; // nombre de archivo, p. ej. "ci.yml"
}

export interface RepoFacts {
  commands: CommandEntry[];
  omittedCommands: { source: CommandSource; count: number }[];
  structure: DirEntry[];
  ciCommands: CiCommand[];
  omittedCiCount: number;
}

export interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;
  promptTemplates(detection: DetectionResult): PromptTemplate[];
}
