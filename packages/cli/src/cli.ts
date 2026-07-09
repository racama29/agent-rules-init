import * as clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { writeGeneratedFiles, type WriteResult } from "./core/writer.js";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderPromptFiles,
  type RenderEntry,
} from "./core/templates.js";
import {
  collectLowConfidenceQuestions,
  askQuestions,
  applyAnswers,
  defaultPromptFn,
  hasInteractiveTty,
  type PromptFn,
} from "./core/prompt-engine.js";
import { detectAvailableAssistants, polishWithAssistant, defaultExecFn, type ExecFn } from "./core/llm-bridge.js";
import type { Pack } from "./core/types.js";
import { jsTsPack } from "agent-rules-pack-js-ts";
import { pythonPack } from "agent-rules-pack-python";
import { javaPack } from "agent-rules-pack-java";
import { phpPack } from "agent-rules-pack-php";

const ALL_PACKS: Pack[] = [jsTsPack, pythonPack, javaPack, phpPack];

export interface RunCliOptions {
  promptFn?: PromptFn;
  execFn?: ExecFn;
  skipLlm?: boolean;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const promptFn = options.promptFn ?? defaultPromptFn;
  const execFn = options.execFn ?? defaultExecFn;

  const signals = scanRepo(rootPath);
  const rawDetections = ALL_PACKS.map((pack) => pack.detect(signals)).filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  const questions = collectLowConfidenceQuestions(rawDetections);
  const answers = await askQuestions(questions, promptFn);
  const detections = applyAnswers(rawDetections, answers);

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection) };
  });

  const files: { path: string; content: string }[] = [];

  if (entries.length > 0) {
    files.push({ path: "CLAUDE.generated.md", content: renderClaudeMd(entries) });
    files.push({ path: "AGENTS.generated.md", content: renderAgentsMd(entries) });
    files.push({
      path: ".github/copilot-instructions.generated.md",
      content: renderCopilotInstructions(entries),
    });
    for (const detection of detections) {
      const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
      for (const file of renderPromptFiles(detection.packId, pack.promptTemplates(detection))) {
        files.push(file);
      }
    }
  } else {
    files.push({
      path: "CLAUDE.generated.md",
      content: "# CLAUDE.md\n\nNo se detectó ningún stack conocido. Completa este archivo manualmente.\n",
    });
  }

  if (!options.skipLlm && hasInteractiveTty()) {
    const assistants = await detectAvailableAssistants(execFn);
    if (assistants.length > 0) {
      const chosenAssistant = assistants[0];
      clack.log.info(`${chosenAssistant} detectado — puede ayudar a pulir la redacción final.`);
      const usePolish = await clack.confirm({
        message: `Se detectó ${chosenAssistant}. ¿Quieres que pula la redacción final?`,
      });
      if (usePolish === true) {
        for (const file of files) {
          file.content = await polishWithAssistant(chosenAssistant, file.content, execFn);
        }
      }
    }
  }

  return writeGeneratedFiles(rootPath, files);
}

export async function main(): Promise<void> {
  clack.intro("agent-rules-init");

  if (!hasInteractiveTty()) {
    console.warn(
      "No se detectó una terminal interactiva (esto pasa a veces en Git Bash en Windows). " +
        "Continuando sin preguntas ni oferta de pulido con IA; se usarán los valores detectados."
    );
  }

  try {
    const results = await runCli(process.cwd());
    const written = results.filter((r) => r.status === "written");
    const failures = results.filter((r) => r.status === "error");

    for (const result of results) {
      if (result.status === "written") {
        clack.log.success(result.path);
      } else {
        clack.log.warn(`${result.path}: ${result.error}`);
      }
    }

    if (written.length > 0) {
      clack.outro(
        "Revisa los archivos *.generated.* y, cuando estés conforme, quita el sufijo " +
          '".generated" (ej. "CLAUDE.generated.md" → "CLAUDE.md") para activarlos — ' +
          "tu asistente de IA solo lee el nombre final, no el generado."
      );
    } else {
      clack.outro("No se generó ningún archivo nuevo.");
    }

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    clack.log.error(`Fallo inesperado: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
