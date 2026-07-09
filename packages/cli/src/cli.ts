#!/usr/bin/env node
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
import { collectLowConfidenceQuestions, askQuestions, defaultPromptFn, type PromptFn } from "./core/prompt-engine.js";
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
  const detections = ALL_PACKS.map((pack) => pack.detect(signals)).filter((d): d is NonNullable<typeof d> => d !== null);

  const questions = collectLowConfidenceQuestions(detections);
  await askQuestions(questions, promptFn);

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
      for (const file of renderPromptFiles(pack.promptTemplates(detection))) {
        files.push(file);
      }
    }
  } else {
    files.push({
      path: "CLAUDE.generated.md",
      content: "# CLAUDE.md\n\nNo se detectó ningún stack conocido. Completa este archivo manualmente.\n",
    });
  }

  if (!options.skipLlm) {
    const assistants = await detectAvailableAssistants(execFn);
    if (assistants.length > 0) {
      const usePolish = await clack.confirm({
        message: `Se detectó ${assistants.join(" y ")}. ¿Quieres que pula la redacción final?`,
      });
      if (usePolish === true) {
        for (const file of files) {
          file.content = await polishWithAssistant(assistants[0], file.content, execFn);
        }
      }
    }
  }

  return writeGeneratedFiles(rootPath, files);
}
