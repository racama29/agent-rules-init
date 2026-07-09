export interface PackageJsonManifest {
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export interface ComposerJsonManifest {
  require: Record<string, string>;
  requireDev: Record<string, string>;
}

export interface RepoSignals {
  rootPath: string;
  files: string[];
  hasFile: (relativePath: string) => boolean;
  hasDir: (relativeDir: string) => boolean;
  packageJson?: PackageJsonManifest;
  pyprojectToml?: string;
  requirementsTxt?: string;
  pomXml?: string;
  buildGradle?: string;
  composerJson?: ComposerJsonManifest;
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

export interface Pack {
  id: string;
  detect(signals: RepoSignals): DetectionResult | null;
  rules(detection: DetectionResult): RuleSet;
  promptTemplates(detection: DetectionResult): PromptTemplate[];
}
