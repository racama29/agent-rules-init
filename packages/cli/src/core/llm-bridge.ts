import { spawn } from "node:child_process";

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
  execFn: ExecFn = defaultExecFn
): Promise<string> {
  const prompt = `Pule la redacción del siguiente documento de instrucciones para un agente de IA, sin cambiar su significado ni estructura. Devuelve únicamente el documento pulido, sin comentarios ni explicaciones adicionales:\n\n${content}`;
  try {
    const result = await execFn(assistant, ["-p"], prompt);
    return result.stdout.trim() || content;
  } catch (err) {
    console.warn(
      `No se pudo pulir el contenido con ${assistant}, se mantiene el original: ${(err as Error).message}`
    );
    return content;
  }
}
