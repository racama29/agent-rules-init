import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  GENERATION_STATE_PATH,
  hashContent,
  loadGenerationState,
  type EnrichmentState,
} from "./generation-state.js";
import type { AssistantId } from "./llm-bridge.js";
import type { GeneratedFile } from "./writer.js";

const CACHE_FORMAT_VERSION = "enrichment-cache-v1";
const MAX_HASHED_FILE_BYTES = 1_000_000;
const MAX_TOTAL_HASHED_BYTES = 20_000_000;

function isGeneratedArtifact(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return normalized === GENERATION_STATE_PATH ||
    normalized.includes(".generated.") ||
    normalized.startsWith(".agent-rules-init/backups/");
}

/**
 * Fast conservative fingerprint: paths, size and mtime cover every file, while normal
 * source/config files are also content-hashed within a bounded 20 MB read budget.
 * Generated artifacts are excluded because writing the cache itself must not invalidate it.
 */
export function fingerprintRepository(rootPath: string, relativePaths: readonly string[]): string {
  const hash = createHash("sha256").update(CACHE_FORMAT_VERSION);
  const root = path.resolve(rootPath);
  let hashedBytes = 0;
  for (const relativePath of [...relativePaths].sort()) {
    if (isGeneratedArtifact(relativePath)) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      hash.update(relativePath).update("\0outside-root\0");
      continue;
    }
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      hash.update(relativePath.replaceAll("\\", "/"))
        .update("\0")
        .update(String(stat.size))
        .update("\0")
        .update(String(stat.mtimeMs))
        .update("\0");
      if (stat.size <= MAX_HASHED_FILE_BYTES && hashedBytes + stat.size <= MAX_TOTAL_HASHED_BYTES) {
        hash.update(fs.readFileSync(absolutePath)).update("\0");
        hashedBytes += stat.size;
      }
    } catch {
      hash.update(relativePath).update("\0missing\0");
    }
  }
  return hash.digest("hex");
}

export function makeEnrichmentState(
  rootPath: string,
  relativePaths: readonly string[],
  baselineHash: string,
  existingDocs: readonly GeneratedFile[],
  assistant: AssistantId,
  model?: string
): EnrichmentState {
  const hash = createHash("sha256")
    .update(CACHE_FORMAT_VERSION)
    .update("\0")
    .update(fingerprintRepository(rootPath, relativePaths))
    .update("\0")
    .update(baselineHash)
    .update("\0")
    .update(assistant)
    .update("\0")
    .update(model ?? "<default>");
  for (const doc of existingDocs) hash.update("\0").update(doc.path).update("\0").update(doc.content);
  return { cacheKey: hash.digest("hex"), assistant, ...(model ? { model } : {}) };
}

export function loadCachedEnrichment(
  rootPath: string,
  baselineHash: string,
  expected: readonly GeneratedFile[],
  requested: EnrichmentState
): GeneratedFile[] | undefined {
  const state = loadGenerationState(rootPath);
  if (!state?.enrichment || state.baselineHash !== baselineHash) return undefined;
  if (state.enrichment.cacheKey !== requested.cacheKey) return undefined;
  const cached: GeneratedFile[] = [];
  const root = path.resolve(rootPath);
  for (const file of expected) {
    const absolutePath = path.resolve(root, file.path);
    if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) return undefined;
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
      const content = fs.readFileSync(absolutePath, "utf8");
      if (state.outputHashes[file.path] !== hashContent(content)) return undefined;
      cached.push({ path: file.path, content });
    } catch {
      return undefined;
    }
  }
  return cached;
}
