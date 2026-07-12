import fs from "node:fs";
import path from "node:path";
import type {
  RepoSignals,
  PackageJsonManifest,
  LocatedPackageJsonManifest,
  ComposerJsonManifest,
  JsPackageManager,
} from "./types.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn",
  "dist", "build", "out", "target", "coverage", "vendor",
  ".venv", "venv", ".tox", "__pycache__",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  ".gradle", ".dart_tool",
  ".agent-rules-init",
]);
const MAX_DEPTH = 4;

function walk(rootPath: string): string[] {
  const results: string[] = [];
  function recurse(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Filesystem enumeration order is not guaranteed. Keep discovery stable so
    // precedence-sensitive facts (for example, the first CI command) are reproducible.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        recurse(path.join(dir, entry.name), depth + 1);
      } else {
        if (entry.name.includes(".generated.")) continue;
        results.push(path.relative(rootPath, path.join(dir, entry.name)));
      }
    }
  }
  recurse(rootPath, 0);
  return results;
}

// Windows editors (Notepad, PowerShell's Set-Content, some IDE defaults) save UTF-8
// with a leading BOM, which JSON.parse rejects and line-anchored regexes trip over.
function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(stripBom(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return undefined;
  }
}

function toPackageJsonManifest(
  raw: Record<string, unknown>,
  relativePath: string
): LocatedPackageJsonManifest {
  return {
    path: relativePath.split(path.sep).join("/"),
    name: raw.name as string | undefined,
    main: typeof raw.main === "string" ? raw.main : undefined,
    dependencies: (raw.dependencies as Record<string, string>) ?? {},
    devDependencies: (raw.devDependencies as Record<string, string>) ?? {},
    scripts: (raw.scripts as Record<string, string>) ?? {},
    moduleType: raw.type === "module" ? "module" : "commonjs",
    packageManager: parsePackageManager(raw.packageManager),
  };
}

function parsePackageManager(value: unknown): JsPackageManager | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().split("@")[0].toLowerCase();
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : undefined;
}

const LOCK_MANAGERS: Readonly<Record<string, JsPackageManager>> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

function managerFromClosestLock(
  manifestPath: string,
  normalizedFiles: ReadonlySet<string>
): JsPackageManager | undefined {
  let dir = path.posix.dirname(manifestPath.split(path.sep).join("/"));
  while (true) {
    for (const [lockName, manager] of Object.entries(LOCK_MANAGERS)) {
      const candidate = dir === "." ? lockName : `${dir}/${lockName}`;
      if (normalizedFiles.has(candidate)) return manager;
    }
    if (dir === ".") return undefined;
    dir = path.posix.dirname(dir);
  }
}

function managerFromClosestDeclaration(
  manifestPath: string,
  declarations: ReadonlyMap<string, JsPackageManager>
): JsPackageManager | undefined {
  let dir = path.posix.dirname(manifestPath);
  while (true) {
    const manager = declarations.get(dir);
    if (manager) return manager;
    if (dir === ".") return undefined;
    dir = path.posix.dirname(dir);
  }
}

function readTextIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return stripBom(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

function shallowest(matches: string[]): string | undefined {
  if (matches.length === 0) return undefined;
  return matches.reduce((shallowestSoFar, candidate) =>
    candidate.split(path.sep).length < shallowestSoFar.split(path.sep).length ? candidate : shallowestSoFar
  );
}

function findFirst(files: string[], fileName: string): string | undefined {
  return shallowest(files.filter((f) => path.basename(f) === fileName));
}

// Directories that routinely carry their own throwaway Python tooling manifest (a
// mkdocs/sphinx docs build, a one-off script, a benchmark harness) in projects whose
// primary language is something else entirely (e.g. nlohmann/json, a C++ library, ships
// docs/mkdocs/requirements.txt). Prefer a candidate outside these dirs when one exists.
const NON_PROJECT_DIRS = new Set([
  "docs",
  "doc",
  "tools",
  "tool",
  "scripts",
  "script",
  "examples",
  "example",
  "benchmark",
  "benchmarks",
  "fixture",
  "fixtures",
]);

function isUnderNonProjectDir(relativePath: string): boolean {
  const segments = relativePath.split(path.sep).slice(0, -1);
  return segments.some((segment) => NON_PROJECT_DIRS.has(segment.toLowerCase()));
}

function findFirstPreferringRealProjectDirs(files: string[], fileName: string): string | undefined {
  const matches = files.filter((f) => path.basename(f) === fileName && !isUnderNonProjectDir(f));
  return shallowest(matches);
}

function findAllByExtension(files: string[], extension: string): string[] {
  return files.filter((f) => f.toLowerCase().endsWith(extension));
}

function findAllByNames(files: string[], names: string[]): string[] {
  return files.filter((f) => names.includes(path.basename(f)));
}

function readAllConcatenated(rootPath: string, relativePaths: string[]): string | undefined {
  if (relativePaths.length === 0) return undefined;
  const contents = relativePaths
    .map((p) => readTextIfExists(path.join(rootPath, p)))
    .filter((content): content is string => content !== undefined);
  return contents.length > 0 ? contents.join("\n") : undefined;
}

function pickShallowest(paths: (string | undefined)[]): string | undefined {
  return shallowest(paths.filter((p): p is string => p !== undefined));
}

export function scanRepo(rootPath: string): RepoSignals {
  const files = walk(rootPath);
  const fileSet = new Set(files.map((f) => f.split(path.sep).join("/")));

  // Keep every project package manifest, not only the root workspace manifest. Root
  // package.json files are often workspace glue and contain none of the dependencies
  // that reveal React/Vitest/etc. Manifests under docs/examples/tooling are excluded to
  // avoid treating auxiliary demos, fixtures and documentation builds as the project.
  const packageJsonPaths = files.filter(
    (f) => path.basename(f) === "package.json" && !isUnderNonProjectDir(f)
  );
  const packageJsons = packageJsonPaths
    .map((relativePath) => {
      const raw = readJsonIfExists(path.join(rootPath, relativePath));
      return raw ? toPackageJsonManifest(raw, relativePath) : undefined;
    })
    .filter((manifest): manifest is LocatedPackageJsonManifest => manifest !== undefined)
    .sort((a, b) => {
      const depth = a.path.split("/").length - b.path.split("/").length;
      return depth || a.path.localeCompare(b.path);
    });
  const declaredManagers = new Map(
    packageJsons
      .filter((manifest): manifest is LocatedPackageJsonManifest & { packageManager: JsPackageManager } =>
        manifest.packageManager !== undefined
      )
      .map((manifest) => [path.posix.dirname(manifest.path), manifest.packageManager] as const)
  );
  // A nested lock takes precedence over an ancestor workspace declaration because it
  // denotes an independently installed package. Both lookups are O(path depth).
  for (const manifest of packageJsons) {
    if (manifest.packageManager) continue;
    manifest.packageManager =
      managerFromClosestLock(manifest.path, fileSet) ??
      managerFromClosestDeclaration(manifest.path, declaredManagers);
  }
  const primaryPackageJson = packageJsons[0];
  const packageJson: PackageJsonManifest | undefined = primaryPackageJson
    ? {
        name: primaryPackageJson.name,
        dependencies: Object.assign({}, ...packageJsons.map((p) => p.dependencies)),
        devDependencies: Object.assign({}, ...packageJsons.map((p) => p.devDependencies)),
        // Root scripts remain the default command surface. Repo facts reads packageJsons
        // directly and adds executable --prefix commands for nested packages.
        scripts: primaryPackageJson.scripts,
        moduleType: primaryPackageJson.moduleType,
        packageManager: primaryPackageJson.packageManager,
        main: primaryPackageJson.main,
      }
    : undefined;

  const composerJsonPath = findFirst(files, "composer.json");
  const rawComposerJson = composerJsonPath
    ? readJsonIfExists(path.join(rootPath, composerJsonPath))
    : undefined;
  const composerJson: ComposerJsonManifest | undefined = rawComposerJson
    ? {
        require: (rawComposerJson.require as Record<string, string>) ?? {},
        requireDev: (rawComposerJson["require-dev"] as Record<string, string>) ?? {},
        scripts: (rawComposerJson.scripts as Record<string, unknown>) ?? {},
      }
    : undefined;

  const pyprojectCandidate = findFirstPreferringRealProjectDirs(files, "pyproject.toml");
  const requirementsCandidate = findFirstPreferringRealProjectDirs(files, "requirements.txt");
  const environmentYmlCandidate =
    findFirstPreferringRealProjectDirs(files, "environment.yml") ??
    findFirstPreferringRealProjectDirs(files, "environment.yaml");
  // Only the shallowest of the three "wins" as the project's Python manifest — otherwise an
  // unrelated pyproject.toml nested inside a vendored/data subdirectory (e.g. a bundled dataset
  // package) would always outrank a real root-level environment.yml just by file type.
  const primaryPythonManifest = pickShallowest([
    pyprojectCandidate,
    requirementsCandidate,
    environmentYmlCandidate,
  ]);
  const pyprojectPath = primaryPythonManifest === pyprojectCandidate ? pyprojectCandidate : undefined;
  const requirementsPath = primaryPythonManifest === requirementsCandidate ? requirementsCandidate : undefined;
  const environmentYmlPath =
    primaryPythonManifest === environmentYmlCandidate ? environmentYmlCandidate : undefined;
  // Multi-module Maven/Gradle projects (parent + child modules) each have their own
  // pom.xml/build.gradle, and the module that actually declares the framework/Kotlin
  // plugin/test runner isn't necessarily the shallowest one. Aggregate all of them.
  const projectFiles = files.filter((file) => !isUnderNonProjectDir(file));
  const pomPaths = findAllByNames(projectFiles, ["pom.xml"]);
  const buildGradlePaths = findAllByNames(projectFiles, ["build.gradle", "build.gradle.kts"]);
  const gemfilePath = findFirst(projectFiles, "Gemfile");
  const goModPath = findFirst(projectFiles, "go.mod");
  const cargoTomlPath = findFirst(projectFiles, "Cargo.toml");
  // .NET solutions routinely split into several .csproj files (domain/infra/web/tests);
  // picking just the "shallowest" one is close to arbitrary and often lands on a plain
  // class library that has neither the web framework nor the test runner reference.
  // Concatenate all of them so detection can find those references wherever they live.
  const csprojPaths = findAllByExtension(projectFiles, ".csproj");
  const packageSwiftPath = findFirst(projectFiles, "Package.swift");
  // Melos/pub workspaces have a root pubspec.yaml that's just workspace glue (no
  // `flutter`/`flutter_test` dependency) plus one real pubspec.yaml per package under
  // packages/*. Aggregate all of them so the actual framework/test runner is found.
  const pubspecYamlPaths = findAllByNames(projectFiles, ["pubspec.yaml"]);
  const cmakeListsPath = findFirst(projectFiles, "CMakeLists.txt");
  // Un Makefile que solo existe bajo docs/, tools/, etc. es tooling auxiliar (p. ej. el
  // Makefile de Sphinx en docs/ de Flask): sus targets no se pueden ejecutar desde la
  // raíz y no describen el proyecto. Mismo criterio que los manifiestos Python.
  const makefilePath =
    findFirstPreferringRealProjectDirs(files, "Makefile") ??
    findFirstPreferringRealProjectDirs(files, "makefile");
  const mixExsPath = findFirst(projectFiles, "mix.exs");
  const buildSbtPath = findFirst(projectFiles, "build.sbt");
  const rDescriptionPath = findFirst(projectFiles, "DESCRIPTION");
  const renvLockPath = findFirst(projectFiles, "renv.lock");
  const toxIniPath = findFirst(projectFiles, "tox.ini");
  const workflowPaths = files.filter((f) => {
    const normalized = f.split(path.sep).join("/");
    return (
      normalized.startsWith(".github/workflows/") &&
      (normalized.endsWith(".yml") || normalized.endsWith(".yaml"))
    );
  });
  const guidanceNames = new Set([
    "CONTRIBUTING.md", ".editorconfig", "tsconfig.json", "pyproject.toml",
  ]);
  const guidancePaths = files.filter((file) => {
    const normalized = file.split(path.sep).join("/");
    return guidanceNames.has(path.posix.basename(normalized));
  });

  return {
    rootPath,
    files,
    hasFile: (relativePath: string) => fileSet.has(relativePath.split(path.sep).join("/")),
    hasDir: (relativeDir: string) =>
      fs.existsSync(path.join(rootPath, relativeDir)) &&
      fs.statSync(path.join(rootPath, relativeDir)).isDirectory(),
    packageJson,
    packageJsons,
    pyprojectToml: pyprojectPath ? readTextIfExists(path.join(rootPath, pyprojectPath)) : undefined,
    requirementsTxt: requirementsPath
      ? readTextIfExists(path.join(rootPath, requirementsPath))
      : undefined,
    environmentYml: environmentYmlPath
      ? readTextIfExists(path.join(rootPath, environmentYmlPath))
      : undefined,
    pomXml: readAllConcatenated(rootPath, pomPaths),
    buildGradle: readAllConcatenated(rootPath, buildGradlePaths),
    composerJson,
    gemfile: gemfilePath ? readTextIfExists(path.join(rootPath, gemfilePath)) : undefined,
    goMod: goModPath ? readTextIfExists(path.join(rootPath, goModPath)) : undefined,
    cargoToml: cargoTomlPath ? readTextIfExists(path.join(rootPath, cargoTomlPath)) : undefined,
    csproj: readAllConcatenated(rootPath, csprojPaths),
    packageSwift: packageSwiftPath ? readTextIfExists(path.join(rootPath, packageSwiftPath)) : undefined,
    pubspecYaml: readAllConcatenated(rootPath, pubspecYamlPaths),
    cmakeLists: cmakeListsPath ? readTextIfExists(path.join(rootPath, cmakeListsPath)) : undefined,
    makefile: makefilePath ? readTextIfExists(path.join(rootPath, makefilePath)) : undefined,
    mixExs: mixExsPath ? readTextIfExists(path.join(rootPath, mixExsPath)) : undefined,
    buildSbt: buildSbtPath ? readTextIfExists(path.join(rootPath, buildSbtPath)) : undefined,
    rDescription: rDescriptionPath ? readTextIfExists(path.join(rootPath, rDescriptionPath)) : undefined,
    renvLock: renvLockPath ? readTextIfExists(path.join(rootPath, renvLockPath)) : undefined,
    toxIni: toxIniPath ? readTextIfExists(path.join(rootPath, toxIniPath)) : undefined,
    githubWorkflows: workflowPaths
      .map((p) => ({
        path: p.split(path.sep).join("/"),
        content: readTextIfExists(path.join(rootPath, p)),
      }))
      .filter((w): w is { path: string; content: string } => w.content !== undefined),
    guidanceFiles: guidancePaths
      .map((p) => ({ path: p.split(path.sep).join("/"), content: readTextIfExists(path.join(rootPath, p)) }))
      .filter((f): f is { path: string; content: string } => f.content !== undefined),
  };
}
