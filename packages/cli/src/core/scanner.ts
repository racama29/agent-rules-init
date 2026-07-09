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

function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

function readTextIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return fs.readFileSync(filePath, "utf-8");
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

function findFirstByExtension(files: string[], extension: string): string | undefined {
  return shallowest(files.filter((f) => f.toLowerCase().endsWith(extension)));
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

  const pyprojectCandidate = findFirst(files, "pyproject.toml");
  const requirementsCandidate = findFirst(files, "requirements.txt");
  const environmentYmlCandidate = findFirst(files, "environment.yml") ?? findFirst(files, "environment.yaml");
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
  const pomPath = findFirst(files, "pom.xml");
  const buildGradlePath = findFirst(files, "build.gradle") ?? findFirst(files, "build.gradle.kts");
  const gemfilePath = findFirst(files, "Gemfile");
  const goModPath = findFirst(files, "go.mod");
  const cargoTomlPath = findFirst(files, "Cargo.toml");
  const csprojPath = findFirstByExtension(files, ".csproj");
  const packageSwiftPath = findFirst(files, "Package.swift");
  const pubspecYamlPath = findFirst(files, "pubspec.yaml");
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
    pomXml: pomPath ? readTextIfExists(path.join(rootPath, pomPath)) : undefined,
    buildGradle: buildGradlePath ? readTextIfExists(path.join(rootPath, buildGradlePath)) : undefined,
    composerJson,
    gemfile: gemfilePath ? readTextIfExists(path.join(rootPath, gemfilePath)) : undefined,
    goMod: goModPath ? readTextIfExists(path.join(rootPath, goModPath)) : undefined,
    cargoToml: cargoTomlPath ? readTextIfExists(path.join(rootPath, cargoTomlPath)) : undefined,
    csproj: csprojPath ? readTextIfExists(path.join(rootPath, csprojPath)) : undefined,
    packageSwift: packageSwiftPath ? readTextIfExists(path.join(rootPath, packageSwiftPath)) : undefined,
    pubspecYaml: pubspecYamlPath ? readTextIfExists(path.join(rootPath, pubspecYamlPath)) : undefined,
    cmakeLists: cmakeListsPath ? readTextIfExists(path.join(rootPath, cmakeListsPath)) : undefined,
    makefile: makefilePath ? readTextIfExists(path.join(rootPath, makefilePath)) : undefined,
    mixExs: mixExsPath ? readTextIfExists(path.join(rootPath, mixExsPath)) : undefined,
    buildSbt: buildSbtPath ? readTextIfExists(path.join(rootPath, buildSbtPath)) : undefined,
    rDescription: rDescriptionPath ? readTextIfExists(path.join(rootPath, rDescriptionPath)) : undefined,
    renvLock: renvLockPath ? readTextIfExists(path.join(rootPath, renvLockPath)) : undefined,
  };
}
