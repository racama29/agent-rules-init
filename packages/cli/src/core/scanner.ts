import fs from "node:fs";
import path from "node:path";
import type { RepoSignals, PackageJsonManifest, ComposerJsonManifest } from "./types.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);
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
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        recurse(path.join(dir, entry.name), depth + 1);
      } else {
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

  const packageJsonPath = findFirst(files, "package.json");
  const rawPackageJson = packageJsonPath
    ? readJsonIfExists(path.join(rootPath, packageJsonPath))
    : undefined;
  const packageJson: PackageJsonManifest | undefined = rawPackageJson
    ? {
        name: rawPackageJson.name as string | undefined,
        dependencies: (rawPackageJson.dependencies as Record<string, string>) ?? {},
        devDependencies: (rawPackageJson.devDependencies as Record<string, string>) ?? {},
        scripts: (rawPackageJson.scripts as Record<string, string>) ?? {},
        moduleType: rawPackageJson.type === "module" ? "module" : "commonjs",
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
  const pomPaths = findAllByNames(files, ["pom.xml"]);
  const buildGradlePaths = findAllByNames(files, ["build.gradle", "build.gradle.kts"]);
  const gemfilePath = findFirst(files, "Gemfile");
  const goModPath = findFirst(files, "go.mod");
  const cargoTomlPath = findFirst(files, "Cargo.toml");
  // .NET solutions routinely split into several .csproj files (domain/infra/web/tests);
  // picking just the "shallowest" one is close to arbitrary and often lands on a plain
  // class library that has neither the web framework nor the test runner reference.
  // Concatenate all of them so detection can find those references wherever they live.
  const csprojPaths = findAllByExtension(files, ".csproj");
  const packageSwiftPath = findFirst(files, "Package.swift");
  // Melos/pub workspaces have a root pubspec.yaml that's just workspace glue (no
  // `flutter`/`flutter_test` dependency) plus one real pubspec.yaml per package under
  // packages/*. Aggregate all of them so the actual framework/test runner is found.
  const pubspecYamlPaths = findAllByNames(files, ["pubspec.yaml"]);
  const cmakeListsPath = findFirst(files, "CMakeLists.txt");
  const makefilePath = findFirst(files, "Makefile") ?? findFirst(files, "makefile");
  const mixExsPath = findFirst(files, "mix.exs");
  const buildSbtPath = findFirst(files, "build.sbt");
  const rDescriptionPath = findFirst(files, "DESCRIPTION");
  const renvLockPath = findFirst(files, "renv.lock");

  return {
    rootPath,
    files,
    hasFile: (relativePath: string) => fileSet.has(relativePath.split(path.sep).join("/")),
    hasDir: (relativeDir: string) =>
      fs.existsSync(path.join(rootPath, relativeDir)) &&
      fs.statSync(path.join(rootPath, relativeDir)).isDirectory(),
    packageJson,
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
  };
}
