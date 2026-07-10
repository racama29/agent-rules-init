import { createRequire } from "node:module";
import * as clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { writeGeneratedFiles, type WriteResult } from "./core/writer.js";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderPromptFiles,
  renderRepoFacts,
  type RenderEntry,
} from "./core/templates.js";
import { buildRepoFacts } from "./core/repo-facts.js";
import type { Lang } from "./core/i18n.js";
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
import { jsTsPack } from "./packs/js-ts.js";
import { pythonPack } from "./packs/python.js";
import { javaPack } from "./packs/java.js";
import { phpPack } from "./packs/php.js";
import { rubyPack } from "./packs/ruby.js";
import { goPack } from "./packs/go.js";
import { rustPack } from "./packs/rust.js";
import { csharpPack } from "./packs/csharp.js";
import { kotlinPack } from "./packs/kotlin.js";
import { swiftPack } from "./packs/swift.js";
import { dartPack } from "./packs/dart.js";
import { cppPack } from "./packs/cpp.js";
import { elixirPack } from "./packs/elixir.js";
import { scalaPack } from "./packs/scala.js";
import { rPack } from "./packs/r.js";

const ALL_PACKS: Pack[] = [
  jsTsPack,
  pythonPack,
  javaPack,
  phpPack,
  rubyPack,
  goPack,
  rustPack,
  csharpPack,
  kotlinPack,
  swiftPack,
  dartPack,
  cppPack,
  elixirPack,
  scalaPack,
  rPack,
];

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
  const facts = buildRepoFacts(signals);

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection) };
  });

  const files: { path: string; content: string }[] = [];

  if (entries.length > 0) {
    files.push({ path: "CLAUDE.generated.md", content: renderClaudeMd(entries, facts) });
    files.push({ path: "AGENTS.generated.md", content: renderAgentsMd(entries, facts) });
    files.push({
      path: ".github/copilot-instructions.generated.md",
      content: renderCopilotInstructions(entries, facts),
    });
    for (const detection of detections) {
      const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
      for (const file of renderPromptFiles(detection.packId, pack.promptTemplates(detection))) {
        files.push(file);
      }
    }
  } else {
    const factsBlock = renderRepoFacts(facts);
    files.push({
      path: "CLAUDE.generated.md",
      content:
        "# CLAUDE.md\n\nNo se detectó ningún stack conocido. Completa este archivo manualmente.\n" +
        (factsBlock ? `\n${factsBlock}\n` : ""),
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

export type CliAction =
  | { kind: "run"; lang?: Lang }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "invalid-lang"; value: string }
  | { kind: "unknown"; flag: string };

function isLang(value: string | undefined): value is Lang {
  return value === "es" || value === "en";
}

export function resolveCliAction(argv: string[]): CliAction {
  let lang: Lang | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--version" || arg === "-v") return { kind: "version" };
    if (arg === "--lang" || arg.startsWith("--lang=")) {
      const value = arg.startsWith("--lang=") ? arg.slice("--lang=".length) : argv[++i] ?? "";
      if (!isLang(value)) return { kind: "invalid-lang", value };
      lang = value;
      continue;
    }
    return { kind: "unknown", flag: arg };
  }
  return lang ? { kind: "run", lang } : { kind: "run" };
}

export function getVersion(): string {
  // Works both from src/ (tests) and dist/ (published bin): ../package.json
  // resolves to packages/cli/package.json in either layout.
  const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
  return pkg.version;
}

const USAGE = `agent-rules-init — genera CLAUDE.md, AGENTS.md, copilot-instructions y prompts de review/refactor/testing a partir del stack detectado en tu repo.

Uso:
  npx agent-rules-init            escanea el directorio actual y genera los archivos *.generated.*
  npx agent-rules-init --help     muestra esta ayuda
  npx agent-rules-init --version  muestra la versión

Los archivos se crean siempre con sufijo .generated y nunca sobrescriben nada existente:
revisa su contenido y quita el sufijo para activarlos.`;

export async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));
  if (action.kind === "help") {
    console.log(USAGE);
    return;
  }
  if (action.kind === "version") {
    console.log(getVersion());
    return;
  }
  if (action.kind === "unknown") {
    console.error(`Opción no reconocida: ${action.flag}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "invalid-lang") {
    console.error(`Valor de --lang no válido: "${action.value}" (usa "es" o "en").\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

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
      } else if (result.status === "skipped") {
        clack.log.info(`${result.path}: ya existía, se conserva sin cambios.`);
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
