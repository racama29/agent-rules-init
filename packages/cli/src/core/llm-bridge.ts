import { spawn } from "node:child_process";
import { UI, type Lang } from "./i18n.js";
import type { GeneratedFile } from "./writer.js";

export type AssistantId = "claude" | "codex";

export interface ExecResult {
  stdout: string;
  exitCode: number;
}

export type ExecFn = (command: string, args: string[], stdin?: string) => Promise<ExecResult>;

const VERSION_ARGS: Record<AssistantId, string[]> = {
  claude: ["--version"],
  codex: ["--version"],
};

export const defaultExecFn: ExecFn = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    // shell:true is only needed on Windows, to resolve npm-installed .cmd/.ps1 shims.
    const child = spawn(command, args, { shell: process.platform === "win32" });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve({ stdout, exitCode });
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

export async function polishWithAssistant(
  assistant: AssistantId,
  content: string,
  execFn: ExecFn = defaultExecFn,
  lang: Lang = "es"
): Promise<string> {
  try {
    const result = await execFn(assistant, ["-p"], UI[lang].polishPrompt(content));
    return result.stdout.trim() || content;
  } catch (err) {
    console.warn(UI[lang].polishFailed(assistant, (err as Error).message));
    return content;
  }
}

const MAX_POLISH_BATCH_CHARS = 60_000;

function makeBatches(files: GeneratedFile[]): GeneratedFile[][] {
  const batches: GeneratedFile[][] = [];
  let current: GeneratedFile[] = [];
  let currentSize = 2;
  for (const file of files) {
    const size = JSON.stringify(file).length + 1;
    if (current.length > 0 && currentSize + size > MAX_POLISH_BATCH_CHARS) {
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

function parsePolishedBatch(stdout: string, originals: GeneratedFile[]): GeneratedFile[] {
  const trimmed = stdout.trim();
  const withoutFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  const parsed: unknown = JSON.parse(withoutFence);
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

/** Polishes typical runs in one assistant process, splitting only very large outputs. */
export async function polishFilesWithAssistant(
  assistant: AssistantId,
  files: GeneratedFile[],
  execFn: ExecFn = defaultExecFn,
  lang: Lang = "es"
): Promise<GeneratedFile[]> {
  const polished: GeneratedFile[] = [];
  for (const batch of makeBatches(files)) {
    try {
      const input = UI[lang].polishBatchPrompt(JSON.stringify(batch));
      const result = await execFn(assistant, ["-p"], input);
      polished.push(...parsePolishedBatch(result.stdout, batch));
    } catch (err) {
      console.warn(UI[lang].polishFailed(assistant, (err as Error).message));
      polished.push(...batch);
    }
  }
  return polished;
}
