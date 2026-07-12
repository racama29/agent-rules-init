import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeGeneratedFiles, type GeneratedFile } from "./writer.js";

export const GENERATION_STATE_PATH = ".agent-rules-init.generated.json";

export interface EnrichmentState {
  cacheKey: string;
  assistant: "claude" | "codex";
  model?: string;
}

export interface GenerationState {
  schemaVersion: 1 | 2;
  baselineHash: string;
  outputHashes: Record<string, string>;
  enrichment?: EnrichmentState;
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
  files: readonly GeneratedFile[],
  enrichment?: EnrichmentState
): GenerationState {
  return {
    schemaVersion: enrichment ? 2 : 1,
    baselineHash,
    outputHashes: Object.fromEntries(files.map((file) => [file.path, hashContent(file.content)])),
    ...(enrichment ? { enrichment } : {}),
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
    if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return undefined;
    if (typeof value.baselineHash !== "string") return undefined;
    if (!value.outputHashes || typeof value.outputHashes !== "object") return undefined;
    if (Object.values(value.outputHashes).some((hash) => typeof hash !== "string")) return undefined;
    if (value.enrichment !== undefined) {
      const enrichment = value.enrichment as Partial<EnrichmentState>;
      if (typeof enrichment.cacheKey !== "string") return undefined;
      if (enrichment.assistant !== "claude" && enrichment.assistant !== "codex") return undefined;
      if (enrichment.model !== undefined && typeof enrichment.model !== "string") return undefined;
    }
    return value as GenerationState;
  } catch {
    return undefined;
  }
}
