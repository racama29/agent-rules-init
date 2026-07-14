import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UI, type Lang } from "./i18n.js";
import type { GeneratedFile } from "./writer.js";

export type AssistantId = "claude" | "codex";

export interface ExecResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export type ExecFn = (command: string, args: string[], stdin?: string, cwd?: string) => Promise<ExecResult>;

const VERSION_ARGS: Record<AssistantId, string[]> = {
  claude: ["--version"],
  codex: ["--version"],
};

// Repository contents are untrusted input. A prompt asking the model to use read tools
// is not a security boundary, so both assistants are constrained at process level too.
// Unsupported safety flags fail closed through the deterministic fallback.
function printArgs(assistant: AssistantId, model?: string): string[] {
  const modelArgs = model ? ["--model", model] : [];
  if (assistant === "claude") {
    return [
      "-p",
      "--safe-mode",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep",
      ...modelArgs,
    ];
  }
  return [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    ...modelArgs,
    "-",
  ];
}

// A hung assistant (expired session, dead network) must not hang the CLI forever.
// Five minutes covers the verified real runs while still placing a useful upper bound;
// callers can lower or raise it explicitly.
export const DEFAULT_EXEC_TIMEOUT_MS = 300_000;
const MAX_ASSISTANT_OUTPUT_CHARS = 2_000_000;
const SAFE_WINDOWS_SHELL_ARG = /^[A-Za-z0-9._:/@+,-]+$/;

export function createDefaultExecFn(timeoutMs = DEFAULT_EXEC_TIMEOUT_MS): ExecFn {
  return (command, args, stdin, cwd) =>
  new Promise((resolve, reject) => {
    if (process.platform === "win32" && args.some((arg) => !SAFE_WINDOWS_SHELL_ARG.test(arg))) {
      reject(new Error(`refusing an unsafe shell argument for ${command}`));
      return;
    }
    // shell:true is only needed on Windows, to resolve npm-installed .cmd/.ps1 shims.
    // cwd matters for enrichment: the assistant explores the repo it runs in with its
    // own read tools, so it must be spawned at the target repo root, not wherever the
    // CLI process happens to live.
    const child = spawn(command, args, { shell: process.platform === "win32", cwd, timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    let outputLimitExceeded = false;
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_ASSISTANT_OUTPUT_CHARS) {
        outputLimitExceeded = true;
        child.kill();
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_ASSISTANT_OUTPUT_CHARS) stderr = stderr.slice(-MAX_ASSISTANT_OUTPUT_CHARS);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (outputLimitExceeded) reject(new Error(`${command} exceeded the assistant output limit`));
      else if (exitCode === 0) resolve({ stdout, stderr, exitCode });
      else if (child.killed) reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
      else {
        const detail = stderr.trim().slice(-2_000).replace(/[\r\n]+/g, " ");
        reject(new Error(`${command} exited with code ${exitCode}${detail ? `: ${detail}` : ""}`));
      }
    });
    // Content always goes through stdin, never as a CLI argument: on Windows, spawn's
    // shell:true routes the command through cmd.exe, which cannot reliably carry a
    // multi-line, multi-KB argument (embedded newlines truncate/corrupt it). Piping
    // via stdin has no such limit and needs no shell-quoting at all.
    child.stdin?.end(stdin ?? "");
  });
}

export const defaultExecFn: ExecFn = createDefaultExecFn();

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

function makeBatches(files: readonly GeneratedFile[]): GeneratedFile[][] {
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
  /** Maintainer-authored statements that enrichment must preserve verbatim. */
  protectedStatements?: readonly string[];
  /** Hand-maintained docs already in the repo (CLAUDE.md, AGENTS.md, …) to integrate, not contradict. */
  existingDocs?: readonly GeneratedFile[];
  /** Model identifier forwarded verbatim to the assistant CLI; its default when omitted. */
  model?: string;
  /** Total attempts per batch, from 1 to 3. */
  maxAttempts?: number;
  onMetrics?: (metrics: EnrichMetrics) => void;
}

export function estimateEnrichment(files: readonly GeneratedFile[]): { characters: number; batches: number } {
  return { characters: JSON.stringify(files).length, batches: makeBatches(files).length };
}

export interface EnrichMetrics {
  assistant: AssistantId;
  model?: string;
  batches: number;
  attempts: number;
  fallbackBatches: number;
  inputChars: number;
  outputChars: number;
  durationMs: number;
  cacheHit: boolean;
  changedFiles: number;
  addedLines: number;
  removedLines: number;
  securityRejections: number;
}

export function summarizeEnrichmentChanges(
  originals: readonly GeneratedFile[],
  enriched: readonly GeneratedFile[]
): Pick<EnrichMetrics, "changedFiles" | "addedLines" | "removedLines"> {
  let changedFiles = 0;
  let addedLines = 0;
  let removedLines = 0;
  for (let index = 0; index < originals.length; index++) {
    const before = originals[index].content.split("\n");
    const after = enriched[index]?.content.split("\n") ?? [];
    if (originals[index].content === enriched[index]?.content) continue;
    changedFiles++;
    const beforeCounts = new Map<string, number>();
    const afterCounts = new Map<string, number>();
    for (const line of before) beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
    for (const line of after) afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
    for (const [line, count] of afterCounts) addedLines += Math.max(0, count - (beforeCounts.get(line) ?? 0));
    for (const [line, count] of beforeCounts) removedLines += Math.max(0, count - (afterCounts.get(line) ?? 0));
  }
  return { changedFiles, addedLines, removedLines };
}

class SecurityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityValidationError";
  }
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
      throw new SecurityValidationError(`assistant dropped a canonical command: ${command}`);
    }
  }
}

function assertProtectedStatementsSurvive(
  enriched: GeneratedFile[],
  originals: GeneratedFile[],
  protectedStatements: readonly string[]
): void {
  for (let index = 0; index < originals.length; index++) {
    for (const statement of protectedStatements) {
      if (originals[index].content.includes(statement) && !enriched[index].content.includes(statement)) {
        throw new SecurityValidationError(`assistant changed maintainer-provided context: ${statement}`);
      }
    }
  }
}

const DANGEROUS_INSTRUCTION = /(?:rm\s+-rf|git\s+reset\s+--hard|curl[^\n|]*\|\s*(?:sh|bash)|invoke-expression|chmod\s+777|sudo\s+)/i;
const NEGATED_DANGER = /(?:never|do not|don't|must not|avoid|nunca|no ejecutes|no ejecutar|evita)/i;

function assertNoNewDangerousInstructions(
  enriched: GeneratedFile[],
  originals: GeneratedFile[]
): void {
  const originalText = originals.map((file) => file.content).join("\n");
  for (const line of enriched.flatMap((file) => file.content.split("\n"))) {
    const dangerous = line.match(DANGEROUS_INSTRUCTION)?.[0];
    if (dangerous && !NEGATED_DANGER.test(line) && !originalText.includes(dangerous)) {
      throw new SecurityValidationError(`assistant introduced a dangerous instruction: ${dangerous}`);
    }
  }
}

function assertNewBulletClaimsCiteEvidence(
  enriched: GeneratedFile[],
  originals: GeneratedFile[]
): void {
  for (let index = 0; index < enriched.length; index++) {
    const originalLines = new Set(originals[index].content.split("\n").map((line) => line.trim()));
    for (const line of enriched[index].content.split("\n")) {
      const trimmed = line.trim();
      if (/^[-*] /.test(trimmed) && !originalLines.has(trimmed) && checkableCitedPaths(trimmed).length === 0) {
        throw new SecurityValidationError("assistant introduced a bullet claim without a checkable evidence path");
      }
    }
  }
}

const PROMPT_INJECTION_LANGUAGE = /(?:ignore (?:all )?(?:previous|prior) instructions|system prompt|developer message|bypass (?:the )?(?:sandbox|permissions|safety)|disable (?:the )?(?:guardrails|validation|security)|exfiltrat|upload (?:the )?(?:secret|credential|token)|lee (?:las )?(?:variables de entorno|credenciales)|ignora (?:todas )?(?:las )?instrucciones (?:anteriores|previas)|mensaje (?:del sistema|de desarrollador))/i;
const COMMAND_TOKEN = /`((?:npm|pnpm|yarn|bun|go|cargo|python|pytest|ruff|mvn|gradle|\.\/gradlew|dotnet|mix|composer|bundle|phpunit|make|cmake|ctest|swift|dart|flutter|sbt|Rscript)\b[^`]*)`/gi;
const PLAIN_COMMAND = /\b((?:npm|pnpm|yarn|bun)\s+(?:run|test|install|build|lint|exec)\b[^.;\n]*|go\s+(?:test|build|run|vet|fmt|generate|get)\b[^.;\n]*|cargo\s+(?:test|build|run|clippy|fmt)\b[^.;\n]*|python\s+-m\s+\S+[^.;\n]*|(?:pytest|ruff|mvn|gradle|dotnet|mix|composer|bundle|phpunit|make|cmake|ctest|swift|dart|flutter|sbt|Rscript)\s+[^.;\n]+)/i;

function assertNoPromptInjectionLanguage(enriched: GeneratedFile[], originals: GeneratedFile[]): void {
  for (let index = 0; index < enriched.length; index++) {
    const originalLines = new Set(originals[index].content.split("\n").map((line) => line.trim()));
    for (const line of enriched[index].content.split("\n")) {
      if (!originalLines.has(line.trim()) && PROMPT_INJECTION_LANGUAGE.test(line)) {
        throw new SecurityValidationError("assistant introduced prompt-injection or safety-bypass language");
      }
    }
  }
}

function assertNoUnverifiedCommands(
  enriched: GeneratedFile[],
  originals: GeneratedFile[],
  allowedCommands: readonly string[]
): void {
  const originalText = originals.map((file) => file.content).join("\n");
  const allowed = new Set(allowedCommands.map((command) => command.trim()));
  for (const file of enriched) {
    for (const match of file.content.matchAll(COMMAND_TOKEN)) {
      const command = match[1].trim();
      if (!originalText.includes(`\`${command}\``) && !allowed.has(command)) {
        throw new SecurityValidationError(`assistant introduced an unverified command: ${command}`);
      }
    }
  }
  for (let index = 0; index < enriched.length; index++) {
    const originalLines = new Set(originals[index].content.split("\n").map((line) => line.trim()));
    for (const line of enriched[index].content.split("\n")) {
      if (originalLines.has(line.trim())) continue;
      const command = line.replace(/`[^`]*`/g, "").match(PLAIN_COMMAND)?.[1]?.replace(/[*_]/g, "").trim();
      if (!command) continue;
      throw new SecurityValidationError(`assistant introduced an unquoted command: ${command}`);
    }
  }
}

function assertNoNewHeadings(enriched: GeneratedFile[], originals: GeneratedFile[]): void {
  for (let index = 0; index < enriched.length; index++) {
    const originalHeadings = new Set(
      originals[index].content.split("\n").filter((line) => /^#{1,6}\s+/.test(line.trim())).map((line) => line.trim())
    );
    for (const heading of enriched[index].content.split("\n").filter((line) => /^#{1,6}\s+/.test(line.trim()))) {
      if (!originalHeadings.has(heading.trim())) {
        throw new SecurityValidationError(`assistant introduced an unapproved section: ${heading.trim()}`);
      }
    }
  }
}

function assistantFailureDetail(assistant: AssistantId, error: unknown): string {
  const message = (error as Error).message;
  if (/unknown (?:option|argument)|unrecognized (?:option|argument)|unexpected argument/i.test(message)) {
    return `${assistant} does not support the required read-only safety flags; update the assistant CLI`;
  }
  if (/not (?:logged|signed) in|unauthenticated|authentication|login required|401\b/i.test(message)) {
    return `${assistant} is installed but not authenticated; sign in with the assistant CLI and retry`;
  }
  if (/enotfound|econnrefused|network|timed? out|connection/i.test(message)) {
    return `${assistant} could not reach its service; check connectivity or lower the enrichment timeout`;
  }
  return message;
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
  const root = path.resolve(rootPath);
  const evidenceExists = (relativePath: string): boolean => {
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) return false;
    try {
      const stat = fs.lstatSync(absolutePath);
      return stat.isFile() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  };
  const checked = files.map((file) => {
    const kept = file.content.split("\n").filter((line) => {
      const cited = checkableCitedPaths(line);
      if (cited.length === 0) return true;
      if (cited.some(evidenceExists)) return true;
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
  const {
    execFn = defaultExecFn, lang = "es", cwd, mustKeep = [], protectedStatements = [], existingDocs = [], model,
    maxAttempts = 2, onMetrics,
  } = options;
  const existingDocsJson = existingDocs.length > 0 ? JSON.stringify(existingDocs) : undefined;
  const enriched: GeneratedFile[] = [];
  const batches = makeBatches(files);
  const startedAt = Date.now();
  let attempts = 0;
  let fallbackBatches = 0;
  let inputChars = 0;
  let outputChars = 0;
  let securityRejections = 0;
  for (const batch of batches) {
    const input = UI[lang].enrichPrompt(JSON.stringify(batch), mustKeep, existingDocsJson);
    let attemptInput = input;
    // Contract violations (invalid JSON, changed paths, dropped commands) are stochastic,
    // especially with smaller models; one bounded retry recovers most of them.
    let attemptsLeft = Math.max(1, Math.min(3, maxAttempts));
    while (attemptsLeft > 0) {
      attemptsLeft--;
      attempts++;
      inputChars += attemptInput.length;
      try {
        const result = await execFn(assistant, printArgs(assistant, model), attemptInput, cwd);
        outputChars += result.stdout.length;
        let parsed = parseAssistantBatch(result.stdout, batch);
        assertMustKeepSurvive(parsed, batch, mustKeep);
        assertProtectedStatementsSurvive(parsed, batch, protectedStatements);
        assertNoNewDangerousInstructions(parsed, batch);
        assertNewBulletClaimsCiteEvidence(parsed, batch);
        assertNoPromptInjectionLanguage(parsed, batch);
        assertNoUnverifiedCommands(parsed, batch, mustKeep);
        assertNoNewHeadings(parsed, batch);
        if (cwd) {
          const verified = dropUnverifiableClaims(parsed, cwd);
          if (verified.missing.length > 0) console.warn(UI[lang].enrichEvidenceDropped(verified.missing));
          parsed = verified.files;
        }
        enriched.push(...parsed);
        break;
      } catch (err) {
        if (err instanceof SecurityValidationError) securityRejections++;
        if (attemptsLeft > 0) {
          const detail = assistantFailureDetail(assistant, err);
          attemptInput = `${input}\n\nYour previous response was rejected: ${detail}. Correct that exact problem and return the required JSON array only.`;
          console.warn(UI[lang].enrichRetrying(assistant));
        } else {
          console.warn(UI[lang].enrichFailed(assistant, assistantFailureDetail(assistant, err)));
          fallbackBatches++;
          enriched.push(...batch);
        }
      }
    }
  }
  const changes = summarizeEnrichmentChanges(files, enriched);
  onMetrics?.({
    assistant,
    model,
    batches: batches.length,
    attempts,
    fallbackBatches,
    inputChars,
    outputChars,
    durationMs: Date.now() - startedAt,
    cacheHit: false,
    ...changes,
    securityRejections,
  });
  return enriched;
}
