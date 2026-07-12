import fs from "node:fs";
import path from "node:path";
import { activePathFor } from "./check-state.js";
import {
  hashContent,
  loadGenerationState,
  writeGenerationState,
} from "./generation-state.js";
import type { GeneratedFile } from "./writer.js";

const BACKUP_ROOT = ".agent-rules-init/backups";

export interface ActivationResult {
  generatedPath: string;
  activePath: string;
  status: "applied" | "unchanged" | "skipped" | "error";
  backupPath?: string;
  error?: string;
}

export class ActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivationError";
  }
}

function assertSafeRegularFile(filePath: string, label: string): void {
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new ActivationError(`refusing to use a symbolic link as ${label}`);
  }
}

function safeResolve(rootPath: string, relativePath: string): string {
  const absolute = path.resolve(rootPath, relativePath);
  const fromRoot = path.relative(path.resolve(rootPath), absolute);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new ActivationError("refusing to activate a path outside the repository root");
  }
  return absolute;
}

function assertParentInside(realRoot: string, absolutePath: string): void {
  const realParent = fs.realpathSync(path.dirname(absolutePath));
  const fromRoot = path.relative(realRoot, realParent);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new ActivationError("refusing to write through a directory outside the repository root");
  }
}

function availableBackupPath(rootPath: string, preferredPath: string): string {
  if (!fs.existsSync(path.resolve(rootPath, preferredPath))) return preferredPath;
  let suffix = 1;
  while (fs.existsSync(path.resolve(rootPath, `${preferredPath}.${suffix}`))) suffix++;
  return `${preferredPath}.${suffix}`;
}

export function applyGeneratedFiles(
  rootPath: string,
  files: readonly GeneratedFile[],
  baselineHash: string,
  now = new Date()
): ActivationResult[] {
  const state = loadGenerationState(rootPath);
  if (!state) throw new ActivationError("no generation receipt found; run the generator first");
  if (state.baselineHash !== baselineHash) {
    throw new ActivationError("the repository changed since generation; run with --force before --apply");
  }

  const backupStamp = now.toISOString().replace(/[:.]/g, "-");
  const realRoot = fs.realpathSync(rootPath);
  const results: ActivationResult[] = [];
  let wroteBackupIgnore = false;

  for (const file of files) {
    const activePath = activePathFor(file.path);
    const stagingAbsolute = safeResolve(rootPath, file.path);
    const activeAbsolute = safeResolve(rootPath, activePath);
    try {
      if (!fs.existsSync(stagingAbsolute)) {
        results.push({ generatedPath: file.path, activePath, status: "skipped" });
        continue;
      }
      assertSafeRegularFile(stagingAbsolute, "generated staging file");
      assertSafeRegularFile(activeAbsolute, "activated file");
      const stagingContent = fs.readFileSync(stagingAbsolute, "utf8");
      const activeContent = fs.existsSync(activeAbsolute)
        ? fs.readFileSync(activeAbsolute, "utf8")
        : undefined;
      if (activeContent === stagingContent) {
        state.outputHashes[file.path] = hashContent(stagingContent);
        results.push({ generatedPath: file.path, activePath, status: "unchanged" });
        continue;
      }

      let backupPath: string | undefined;
      if (activeContent !== undefined) {
        backupPath = availableBackupPath(
          rootPath,
          path.join(BACKUP_ROOT, backupStamp, activePath).split(path.sep).join("/")
        );
        const backupAbsolute = safeResolve(rootPath, backupPath);
        fs.mkdirSync(path.dirname(backupAbsolute), { recursive: true });
        assertParentInside(realRoot, backupAbsolute);
        fs.copyFileSync(activeAbsolute, backupAbsolute, fs.constants.COPYFILE_EXCL);
        if (!wroteBackupIgnore) {
          const metadataRoot = path.join(rootPath, ".agent-rules-init");
          fs.mkdirSync(metadataRoot, { recursive: true });
          const ignorePath = path.join(metadataRoot, ".gitignore");
          if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, "*\n");
          wroteBackupIgnore = true;
        }
      }

      fs.mkdirSync(path.dirname(activeAbsolute), { recursive: true });
      assertParentInside(realRoot, activeAbsolute);
      fs.writeFileSync(activeAbsolute, stagingContent);
      state.outputHashes[file.path] = hashContent(stagingContent);
      results.push({ generatedPath: file.path, activePath, status: "applied", backupPath });
    } catch (error) {
      results.push({
        generatedPath: file.path,
        activePath,
        status: "error",
        error: (error as Error).message,
      });
    }
  }

  writeGenerationState(rootPath, state);
  return results;
}
