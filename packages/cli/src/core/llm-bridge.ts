import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UI, type Lang } from "./i18n.js";
import type { GeneratedFile } from "./writer.js";

export type AssistantId = "claude" | "codex";

export interface ExecResult {
  stdout: string;
  exitCode: number;
}

export type ExecFn = (command: string, args: string[], stdin?: string, cwd?: string) => Promise<ExecResult>;

const VERSION_ARGS: Record<AssistantId, string[]> = {
  claude: ["--version"],
  codex: ["--version"],
};

// Non-interactive invocation per assistant. claude reads the prompt from stdin with -p;
// codex has no -p: its non-interactive mode is `codex exec`, where "-" reads the
// instructions from stdin. Without --skip-git-repo-check codex refuses to run in
// directories that aren't a git repo; enrichment is read-only, so skipping is safe
// (verified against codex-cli 0.130.0). The model string is passed through untouched —
// the assistant validates it, so new models need no package update.
function printArgs(assistant: AssistantId, model?: string): string[] {
  const modelArgs = model ? ["--model", model] : [];
  if (assistant === "claude") return ["-p", ...modelArgs];
  return ["exec", "--skip-git-repo-check", ...modelArgs, "-"];
}

// A hung assistant (expired session, dead network) must not hang the CLI forever;
// 10 minutes comfortably covers real enrichment runs, and on expiry the rejection
// lands in the normal fallback path that keeps the deterministic files.
const EXEC_TIMEOUT_MS = 600_000;

export const defaultExecFn: ExecFn = (command, args, stdin, cwd) =>
  new Promise((resolve, reject) => {
    // shell:true is only needed on Windows, to resolve npm-installed .cmd/.ps1 shims.
    // cwd matters for enrichment: the assistant explores the repo it runs in with its
    // own read tools, so it must be spawned at the target repo root, not wherever the
    // CLI process happens to live.
    const child = spawn(command, args, { shell: process.platform === "win32", cwd, timeout: EXEC_TIMEOUT_MS });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve({ stdout, exitCode });
      else if (child.killed) reject(new Error(`${command} timed out after ${EXEC_TIMEOUT_MS / 1000}s`));
      else reject(new Error(`${command} exited with code ${exitCode}`));
    });
    // Content always goes through stdin, never as a CLI argument: on Windows, spawn's
    // shell:true routes the command through cmd.exe, which cannot reliably carry a
    // multi-line, multi-KB argument (embedded newlines truncate/corrupt it). Piping
    // via stdin has no such limit and needs no shell-quoting at all.
    child.stdin?.end(stdin ?? "");
  });

export async function detectAvailableAssistants(execFn: ExecFn = defaultExecFn): Promise<AssistantId[]> {
  const candidates: AssistantId[] = ["claude", "codex"];
  const results = await Promise.all(
    candidates.map(async (id) => {
      try {
        await execFn(id, VERSION_ARGS[id]);
        return id;
      } catch {
        return null;
      }
    })
  );
  return results.filter((id): id is AssistantId => id !== null);
}

const MAX_BATCH_CHARS = 60_000;

function makeBatches(files: GeneratedFile[]): GeneratedFile[][] {
  const batches: GeneratedFile[][] = [];
  let current: GeneratedFile[] = [];
  let currentSize = 2;
  for (const file of files) {
    const size = JSON.stringify(file).length + 1;
    if (current.length > 0 && currentSize + size > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(file);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Despite being told to return only JSON, assistants often prepend prose ("I investigated
// the repo and...") or wrap the array in a fence. Try the strict forms first and fall back
// to the outermost [...] slice; path/count validation below rejects any wrong pick.
function extractJsonArray(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced?.trim().startsWith("[")) return fenced;
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseAssistantBatch(stdout: string, originals: GeneratedFile[]): GeneratedFile[] {
  const parsed: unknown = JSON.parse(extractJsonArray(stdout));
  if (!Array.isArray(parsed) || parsed.length !== originals.length) {
    throw new Error("assistant returned a different number of files");
  }
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error("assistant returned an invalid file entry");
    const entry = value as Record<string, unknown>;
    if (entry.path !== originals[index].path || typeof entry.content !== "string") {
      throw new Error("assistant changed a path or returned invalid content");
    }
    return { path: originals[index].path, content: entry.content };
  });
}

export interface EnrichOptions {
  execFn?: ExecFn;
  lang?: Lang;
  /** Repo root where the assistant is spawned so its read tools explore the right project. */
  cwd?: string;
  /** Commands that must survive verbatim (canonical test/lint/build commands). */
  mustKeep?: readonly string[];
  /** Hand-maintained docs already in the repo (CLAUDE.md, AGENTS.md, …) to integrate, not contradict. */
  existingDocs?: readonly GeneratedFile[];
  /** Model identifier forwarded verbatim to the assistant CLI; its default when omitted. */
  model?: string;
}

// The assistant is free-form: it may drop the one command CI actually runs and invent a
// plausible replacement. Any lost must-keep command invalidates the whole batch.
function assertMustKeepSurvive(
  enriched: GeneratedFile[],
  originals: GeneratedFile[],
  mustKeep: readonly string[]
): void {
  const originalText = originals.map((f) => f.content).join("\n");
  const enrichedText = enriched.map((f) => f.content).join("\n");
  for (const command of mustKeep) {
    if (originalText.includes(command) && !enrichedText.includes(command)) {
      throw new Error(`assistant dropped a canonical command: ${command}`);
    }
  }
}

const EVIDENCE_GROUP = /\((?:evidencia|evidence):([^)]*)\)/gi;
// A checkable citation is a plain relative path; tokens with spaces, URLs or globs are
// left alone rather than guessed at.
const PATH_TOKEN = /^[\w.@~-]+(?:[\\/][\w.@~-]+)*[\\/]?$/;

function checkableCitedPaths(line: string): string[] {
  const paths: string[] = [];
  for (const group of line.matchAll(EVIDENCE_GROUP)) {
    for (const token of group[1].matchAll(/`([^`]+)`/g)) {
      // Normalize `src/app.py:12` and `pyproject.toml [tool.ruff]` down to the file path.
      const normalized = token[1].replace(/:\d+(?:-\d+)?$/, "").replace(/\s*\[[^\]]*\]$/, "").trim();
      if (PATH_TOKEN.test(normalized)) paths.push(normalized);
    }
  }
  return paths;
}

// Cited evidence is the enrichment's core promise, so it gets checked against the repo:
// a claim whose cited files all fail to exist is unverifiable. Bullet claims are dropped;
// prose lines are kept (removing them would mangle paragraphs) but still reported.
function dropUnverifiableClaims(
  files: GeneratedFile[],
  rootPath: string
): { files: GeneratedFile[]; missing: string[] } {
  const missing = new Set<string>();
  const checked = files.map((file) => {
    const kept = file.content.split("\n").filter((line) => {
      const cited = checkableCitedPaths(line);
      if (cited.length === 0) return true;
      if (cited.some((p) => fs.existsSync(path.join(rootPath, p)))) return true;
      for (const p of cited) missing.add(p);
      return !/^\s*[-*] /.test(line);
    });
    return { path: file.path, content: kept.join("\n") };
  });
  return { files: checked, missing: [...missing] };
}

/**
 * Asks the assistant to investigate the repository it runs in and rewrite the generated
 * files with repo-specific, evidence-backed guidance. Typical runs use one assistant
 * process; only very large outputs are split. Falls back to the originals per batch.
 */
export async function enrichFilesWithAssistant(
  assistant: AssistantId,
  files: GeneratedFile[],
  options: EnrichOptions = {}
): Promise<GeneratedFile[]> {
  const { execFn = defaultExecFn, lang = "es", cwd, mustKeep = [], existingDocs = [], model } = options;
  const existingDocsJson = existingDocs.length > 0 ? JSON.stringify(existingDocs) : undefined;
  const enriched: GeneratedFile[] = [];
  for (const batch of makeBatches(files)) {
    const input = UI[lang].enrichPrompt(JSON.stringify(batch), mustKeep, existingDocsJson);
    // Contract violations (invalid JSON, changed paths, dropped commands) are stochastic,
    // especially with smaller models; one bounded retry recovers most of them.
    let attemptsLeft = 2;
    while (attemptsLeft > 0) {
      attemptsLeft--;
      try {
        const result = await execFn(assistant, printArgs(assistant, model), input, cwd);
        let parsed = parseAssistantBatch(result.stdout, batch);
        assertMustKeepSurvive(parsed, batch, mustKeep);
        if (cwd) {
          const verified = dropUnverifiableClaims(parsed, cwd);
          if (verified.missing.length > 0) console.warn(UI[lang].enrichEvidenceDropped(verified.missing));
          parsed = verified.files;
        }
        enriched.push(...parsed);
        break;
      } catch (err) {
        if (attemptsLeft > 0) {
          console.warn(UI[lang].enrichRetrying(assistant));
        } else {
          console.warn(UI[lang].enrichFailed(assistant, (err as Error).message));
          enriched.push(...batch);
        }
      }
    }
  }
  return enriched;
}
