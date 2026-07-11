import path from "node:path";
import type { LocatedPackageJsonManifest, PackageJsonManifest, RepoSignals } from "./types.js";

export interface ProjectUnit {
  /** POSIX path relative to the repository root. */
  path: string;
  signals: RepoSignals;
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function matchesPattern(projectPath: string, rawPattern: string): boolean {
  const value = normalize(projectPath);
  const pattern = normalize(rawPattern);
  if (!pattern) return false;
  if (pattern.endsWith("/**") && value === pattern.slice(0, -3)) return true;
  const marker = "\u0000";
  const regex = pattern
    .replace(/\*\*/g, marker)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(marker, "g"), ".*");
  return new RegExp(`^${regex}$`).test(value);
}

export function isProjectExcluded(projectPath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(projectPath, pattern));
}

/** Removes excluded JS packages before repo-wide aggregation and scoped rendering. */
export function applyProjectExcludes(signals: RepoSignals, patterns: readonly string[]): RepoSignals {
  if (patterns.length === 0 || !signals.packageJsons?.length) return signals;
  const packageJsons = signals.packageJsons.filter((manifest) => {
    const packageDir = path.posix.dirname(manifest.path);
    return packageDir === "." || !isProjectExcluded(packageDir, patterns);
  });
  const excludedDirs = (signals.packageJsons ?? [])
    .map((manifest) => path.posix.dirname(manifest.path))
    .filter((dir) => dir !== "." && isProjectExcluded(dir, patterns));
  const isExcludedPath = (relativePath: string) => {
    const normalized = normalize(relativePath);
    return excludedDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
  };
  const primary = packageJsons[0];
  const packageJson = primary
    ? {
        name: primary.name,
        dependencies: Object.assign({}, ...packageJsons.map((manifest) => manifest.dependencies)),
        devDependencies: Object.assign({}, ...packageJsons.map((manifest) => manifest.devDependencies)),
        scripts: primary.scripts,
        moduleType: primary.moduleType,
        packageManager: primary.packageManager,
      }
    : undefined;
  return {
    ...signals,
    files: signals.files.filter((file) => !isExcludedPath(file)),
    hasFile: (relativePath) => !isExcludedPath(relativePath) && signals.hasFile(relativePath),
    hasDir: (relativeDir) => !isExcludedPath(relativeDir) && signals.hasDir(relativeDir),
    packageJson,
    packageJsons,
  };
}

function withoutLocation(manifest: LocatedPackageJsonManifest): PackageJsonManifest {
  const { path: _path, ...packageJson } = manifest;
  return packageJson;
}

/**
 * Creates an isolated RepoSignals view for every nested JS/TS package.
 *
 * Files and presence checks become relative to the package, so packs can run without
 * learning workspace-specific rules and cannot accidentally use a sibling's stack.
 */
export function buildPackageUnits(signals: RepoSignals): ProjectUnit[] {
  return (signals.packageJsons ?? [])
    .filter((manifest) => manifest.path !== "package.json")
    .map((manifest) => {
      const unitPath = path.posix.dirname(manifest.path);
      const prefix = `${unitPath}/`;
      const unitFiles = signals.files
        .map((file) => file.split(path.sep).join("/"))
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length));
      const packageJson = withoutLocation(manifest);

      return {
        path: unitPath,
        signals: {
          rootPath: path.join(signals.rootPath, ...unitPath.split("/")),
          files: unitFiles,
          hasFile: (relativePath) => signals.hasFile(`${prefix}${relativePath}`),
          hasDir: (relativeDir) => signals.hasDir(`${prefix}${relativeDir}`),
          packageJson,
          packageJsons: [{ ...packageJson, path: "package.json" }],
        },
      };
    });
}
