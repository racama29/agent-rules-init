import { spawn } from "node:child_process";

export type AssistantId = "claude" | "codex";

export interface ExecResult {
  stdout: string;
  exitCode: number;
}

export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

const VERSION_ARGS: Record<AssistantId, string[]> = {
  claude: ["--version"],
  codex: ["--version"],
};

export const defaultExecFn: ExecFn = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: true });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve({ stdout, exitCode });
      else reject(new Error(`${command} exited with code ${exitCode}`));
    });
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
  const prompt = `Pule la redacción del siguiente documento de instrucciones para un agente de IA, sin cambiar su significado ni estructura:\n\n${content}`;
  try {
    const result = await execFn(assistant, ["-p", prompt]);
    return result.stdout.trim() || content;
  } catch {
    return content;
  }
}
