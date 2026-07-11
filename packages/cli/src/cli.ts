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
import { UI, detectLang, type Lang } from "./core/i18n.js";
import {
  collectLowConfidenceQuestions,
  askQuestions,
  applyAnswers,
  makeDefaultPromptFn,
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
  lang?: Lang;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const execFn = options.execFn ?? defaultExecFn;
  const lang = options.lang ?? detectLang();
  const promptFn = options.promptFn ?? makeDefaultPromptFn(lang);
  const ui = UI[lang];

  const signals = scanRepo(rootPath);
  const rawDetections = ALL_PACKS.map((pack) => pack.detect(signals)).filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  const questions = collectLowConfidenceQuestions(rawDetections, lang);
  const answers = await askQuestions(questions, promptFn);
  const detections = applyAnswers(rawDetections, answers);
  const facts = buildRepoFacts(signals, lang);

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection, lang) };
  });

  const files: { path: string; content: string }[] = [];

  if (entries.length > 0) {
    files.push({ path: "CLAUDE.generated.md", content: renderClaudeMd(entries, facts, lang) });
    files.push({ path: "AGENTS.generated.md", content: renderAgentsMd(entries, facts, lang) });
    files.push({
      path: ".github/copilot-instructions.generated.md",
      content: renderCopilotInstructions(entries, facts, lang),
    });
    for (const detection of detections) {
      const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
      for (const file of renderPromptFiles(detection.packId, pack.promptTemplates(detection, lang))) {
        files.push(file);
      }
    }
  } else {
    const factsBlock = renderRepoFacts(facts, lang);
    files.push({
      path: "CLAUDE.generated.md",
      content: `# CLAUDE.md\n\n${ui.noStackFallback}\n` + (factsBlock ? `\n${factsBlock}\n` : ""),
    });
  }

  if (!options.skipLlm && hasInteractiveTty()) {
    const assistants = await detectAvailableAssistants(execFn);
    if (assistants.length > 0) {
      const chosenAssistant = assistants[0];
      clack.log.info(ui.polishDetected(chosenAssistant));
      const usePolish = await clack.confirm({ message: ui.polishConfirm(chosenAssistant) });
      if (usePolish === true) {
        for (const file of files) {
          file.content = await polishWithAssistant(chosenAssistant, file.content, execFn, lang);
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

export async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));
  const lang = action.kind === "run" && action.lang ? action.lang : detectLang();
  const ui = UI[lang];

  if (action.kind === "help") {
    console.log(ui.usage);
    return;
  }
  if (action.kind === "version") {
    console.log(getVersion());
    return;
  }
  if (action.kind === "unknown") {
    console.error(`${ui.unknownOption(action.flag)}\n\n${ui.usage}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "invalid-lang") {
    console.error(`${ui.invalidLang(action.value)}\n\n${ui.usage}`);
    process.exitCode = 1;
    return;
  }

  clack.intro("agent-rules-init");

  if (!hasInteractiveTty()) {
    console.warn(ui.noTtyWarning);
  }

  try {
    const results = await runCli(process.cwd(), { lang });
    const written = results.filter((r) => r.status === "written");
    const failures = results.filter((r) => r.status === "error");

    for (const result of results) {
      if (result.status === "written") {
        clack.log.success(result.path);
      } else if (result.status === "skipped") {
        clack.log.info(ui.fileSkipped(result.path));
      } else {
        clack.log.warn(`${result.path}: ${result.error}`);
      }
    }

    if (written.length > 0) {
      clack.outro(ui.outroWritten);
    } else {
      clack.outro(ui.outroNothing);
    }

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    clack.log.error(ui.unexpectedError((err as Error).message));
    process.exitCode = 1;
  }
}
