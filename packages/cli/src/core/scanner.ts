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

function findFirst(files: string[], fileName: string): string | undefined {
  const matches = files.filter((f) => path.basename(f) === fileName);
  if (matches.length === 0) return undefined;
  return matches.reduce((shallowest, candidate) =>
    candidate.split(path.sep).length < shallowest.split(path.sep).length ? candidate : shallowest
  );
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

  const pyprojectPath = findFirst(files, "pyproject.toml");
  const requirementsPath = findFirst(files, "requirements.txt");
  const pomPath = findFirst(files, "pom.xml");
  const buildGradlePath = findFirst(files, "build.gradle") ?? findFirst(files, "build.gradle.kts");

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
    pomXml: pomPath ? readTextIfExists(path.join(rootPath, pomPath)) : undefined,
    buildGradle: buildGradlePath ? readTextIfExists(path.join(rootPath, buildGradlePath)) : undefined,
    composerJson,
  };
}
