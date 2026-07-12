import fs from "node:fs";
import path from "node:path";
import { hashContent, loadGenerationState } from "./generation-state.js";
import type { GeneratedFile } from "./writer.js";

export interface GeneratedFileState {
  generatedPath: string;
  activePath: string;
  stagingExists: boolean;
  activeExists: boolean;
  effectivePath?: string;
  current: boolean;
}

export interface GenerationCheck {
  baselineMatches?: boolean;
  recordedBaselineHash?: string;
  fileStates: GeneratedFileState[];
  missing: GeneratedFile[];
  outdated: GeneratedFile[];
}

export function activePathFor(generatedPath: string): string {
  return generatedPath.replace(".generated", "");
}

export function evaluateGenerationCheck(
  rootPath: string,
  files: readonly GeneratedFile[],
  baselineHash: string | undefined
): GenerationCheck {
  const generationState = loadGenerationState(rootPath);
  const baselineMatches = generationState
    ? generationState.baselineHash === baselineHash
    : undefined;
  const fileStates = files.map((file): GeneratedFileState => {
    const activePath = activePathFor(file.path);
    const stagingAbsolute = path.join(rootPath, file.path);
    const activeAbsolute = path.join(rootPath, activePath);
    const stagingExists = fs.existsSync(stagingAbsolute);
    const activeExists = fs.existsSync(activeAbsolute);
    const effectivePath = activeExists ? activePath : stagingExists ? file.path : undefined;
    const effectiveAbsolute = activeExists ? activeAbsolute : stagingExists ? stagingAbsolute : undefined;
    const expectedHash = baselineMatches ? generationState?.outputHashes[file.path] : undefined;
    const current = effectiveAbsolute
      ? expectedHash
        ? hashContent(fs.readFileSync(effectiveAbsolute, "utf8")) === expectedHash
        : fs.readFileSync(effectiveAbsolute, "utf8") === file.content
      : false;
    return { generatedPath: file.path, activePath, stagingExists, activeExists, effectivePath, current };
  });
  const missing = files.filter(
    (file) => !fileStates.find((state) => state.generatedPath === file.path)?.effectivePath
  );
  const outdated = generationState && baselineMatches === false
    ? [...files]
    : files.filter((file) => {
        const state = fileStates.find((candidate) => candidate.generatedPath === file.path);
        return state?.effectivePath !== undefined && !state.current;
      });
  return {
    baselineMatches,
    recordedBaselineHash: generationState?.baselineHash,
    fileStates,
    missing,
    outdated,
  };
}
