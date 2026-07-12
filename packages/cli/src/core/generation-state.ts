import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeGeneratedFiles, type GeneratedFile } from "./writer.js";

export const GENERATION_STATE_PATH = ".agent-rules-init.generated.json";

export interface GenerationState {
  schemaVersion: 1;
  baselineHash: string;
  outputHashes: Record<string, string>;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashGeneratedFiles(files: readonly GeneratedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path).update("\0").update(file.content).update("\0");
  return hash.digest("hex");
}

export function makeGenerationState(
  baselineHash: string,
  files: readonly GeneratedFile[]
): GenerationState {
  return {
    schemaVersion: 1,
    baselineHash,
    outputHashes: Object.fromEntries(files.map((file) => [file.path, hashContent(file.content)])),
  };
}

export function writeGenerationState(rootPath: string, state: GenerationState): void {
  const [result] = writeGeneratedFiles(
    rootPath,
    [{ path: GENERATION_STATE_PATH, content: `${JSON.stringify(state, null, 2)}\n` }],
    { force: true }
  );
  if (result.status === "error") throw new Error(`cannot write generation state: ${result.error}`);
}

export function loadGenerationState(rootPath: string): GenerationState | undefined {
  const statePath = path.join(rootPath, GENERATION_STATE_PATH);
  if (!fs.existsSync(statePath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8")) as Partial<GenerationState>;
    if (value.schemaVersion !== 1 || typeof value.baselineHash !== "string") return undefined;
    if (!value.outputHashes || typeof value.outputHashes !== "object") return undefined;
    if (Object.values(value.outputHashes).some((hash) => typeof hash !== "string")) return undefined;
    return value as GenerationState;
  } catch {
    return undefined;
  }
}
