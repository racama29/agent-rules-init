import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import * as clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { writeGeneratedFiles, type GeneratedFile, type WriteResult } from "./core/writer.js";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderPromptFiles,
  type RenderEntry,
} from "./core/templates.js";
import { buildRepoFacts } from "./core/repo-facts.js";
import { UI, detectLang, type Lang } from "./core/i18n.js";
import { loadConfig, type AgentRulesConfig } from "./core/config.js";
import { applyProjectExcludes, buildPackageUnits } from "./core/project-units.js";
import { renderProjectUnitAgents } from "./core/project-unit-output.js";
import {
  collectLowConfidenceQuestions,
  askQuestions,
  applyAnswers,
  makeDefaultPromptFn,
  hasInteractiveTty,
  type PromptFn,
} from "./core/prompt-engine.js";
import {
  detectAvailableAssistants,
  enrichFilesWithAssistant,
  defaultExecFn,
  type AssistantId,
  type ExecFn,
} from "./core/llm-bridge.js";
import type { Pack, RepoFacts } from "./core/types.js";
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
  /** Generate results without changing the filesystem. */
  dryRun?: boolean;
  /** Do not prompt or offer AI enrichment. */
  nonInteractive?: boolean;
  /** Run AI enrichment without asking, even without a TTY. Ignored when skipLlm or noAi apply. */
  enrich?: boolean;
  /** Assistant to enrich with; defaults to the first one installed. */
  assistant?: AssistantId;
  /** Model forwarded verbatim to the assistant CLI; its default when omitted. */
  model?: string;
  /** Receives the rendered files before they are written (or planned). */
  onGeneratedFiles?: (files: readonly GeneratedFile[]) => void;
  /** Preloaded repository configuration; loaded from disk when omitted. */
  config?: AgentRulesConfig;
  onConfigWarnings?: (warnings: readonly string[]) => void;
  /** Receives the facts extracted from the repo (including canonical commands). */
  onFacts?: (facts: RepoFacts) => void;
}

// Final-name docs the tool itself would generate; when they already exist they carry the
// team's hand-written intent, so enrichment must integrate them instead of ignoring them.
const EXISTING_DOC_PATHS = ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"];
const MAX_EXISTING_DOC_CHARS = 20_000;

function readExistingDocs(rootPath: string): GeneratedFile[] {
  const docs: GeneratedFile[] = [];
  for (const relativePath of EXISTING_DOC_PATHS) {
    const absolutePath = path.join(rootPath, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, "utf8");
    if (content.trim() === "") continue;
    docs.push({ path: relativePath, content: content.slice(0, MAX_EXISTING_DOC_CHARS) });
  }
  return docs;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const loadedConfig = options.config ? { config: options.config, warnings: [] } : loadConfig(rootPath);
  const config = loadedConfig.config;
  options.onConfigWarnings?.(loadedConfig.warnings);
  const execFn = options.execFn ?? defaultExecFn;
  const lang = options.lang ?? config.lang ?? detectLang();
  const promptFn = options.promptFn ?? makeDefaultPromptFn(lang);
  const ui = UI[lang];

  const signals = applyProjectExcludes(scanRepo(rootPath), config.exclude ?? []);
  const rawDetections = ALL_PACKS.map((pack) => pack.detect(signals)).filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  const questions = collectLowConfidenceQuestions(rawDetections, lang);
  const answers = options.nonInteractive ? {} : await askQuestions(questions, promptFn);
  const detections = applyAnswers(rawDetections, answers);
  const facts = buildRepoFacts(signals, lang);
  options.onFacts?.(facts);
  const ctx = { facts, signals };

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = ALL_PACKS.find((p) => p.id === detection.packId)!;
    return { detection, ruleSet: pack.rules(detection, lang, ctx) };
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
      for (const file of renderPromptFiles(detection.packId, pack.promptTemplates(detection, lang, ctx))) {
        files.push(file);
      }
    }
  } else {
    const withFallback = (content: string) =>
      content.replace(ui.generatedHeader, `${ui.generatedHeader}\n\n${ui.noStackFallback}`);
    files.push(
      { path: "CLAUDE.generated.md", content: withFallback(renderClaudeMd([], facts, lang)) },
      { path: "AGENTS.generated.md", content: withFallback(renderAgentsMd([], facts, lang)) },
      {
        path: ".github/copilot-instructions.generated.md",
        content: withFallback(renderCopilotInstructions([], facts, lang)),
      }
    );
  }

  // Nested AGENTS files are intentionally limited to package-local facts and stack
  // signals. The root documents remain the cross-repository overview.
  for (const unit of buildPackageUnits(signals)) {
    const scoped = renderProjectUnitAgents(unit, lang, config.projects?.[unit.path]);
    if (scoped) files.push(scoped);
  }

  const wantsEnrich = options.enrich === true;
  const canOfferEnrich = !options.nonInteractive && hasInteractiveTty();
  if (!options.skipLlm && !config.noAi && (wantsEnrich || canOfferEnrich)) {
    // With --enrich there may be no TTY (scripts, CI); route progress through stderr so
    // stdout stays parseable in --json mode.
    const notify = canOfferEnrich ? (message: string) => clack.log.info(message) : (message: string) => console.warn(message);
    const assistants = await detectAvailableAssistants(execFn);
    const requested = options.assistant;
    if (requested && !assistants.includes(requested)) {
      console.warn(ui.assistantNotAvailable(requested));
    } else if (assistants.length === 0) {
      if (wantsEnrich) console.warn(ui.enrichNoAssistant);
    } else {
      const chosenAssistant = requested ?? assistants[0];
      let proceed = wantsEnrich;
      if (!proceed) {
        clack.log.info(ui.enrichDetected(chosenAssistant));
        proceed = (await clack.confirm({ message: ui.enrichConfirm(chosenAssistant) })) === true;
      }
      if (proceed) {
        const spinner = canOfferEnrich ? clack.spinner() : undefined;
        if (spinner) spinner.start(ui.enrichWorking(chosenAssistant));
        else notify(ui.enrichWorking(chosenAssistant));
        const enriched = await enrichFilesWithAssistant(chosenAssistant, files, {
          execFn,
          lang,
          cwd: rootPath,
          mustKeep: facts.canonical.map((c) => c.command),
          existingDocs: readExistingDocs(rootPath),
          model: options.model,
        });
        const changed = enriched.some((file, i) => file.content !== files[i].content);
        const outcome = changed ? ui.enrichDone : ui.enrichKept;
        if (spinner) spinner.stop(outcome);
        else notify(outcome);
        files.splice(0, files.length, ...enriched);
      }
    }
  }

  options.onGeneratedFiles?.(files);
  if (options.dryRun) {
    return files.map((file) => ({
      path: file.path,
      status: fs.existsSync(path.join(rootPath, file.path)) ? "skipped" : "written",
    }));
  }
  return writeGeneratedFiles(rootPath, files);
}

export interface CliRunOptions {
  lang?: Lang;
  dryRun?: true;
  check?: true;
  json?: true;
  nonInteractive?: true;
  enrich?: true;
  assistant?: AssistantId;
  model?: string;
}

export type CliAction =
  | ({ kind: "run" } & CliRunOptions)
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "invalid-lang"; value: string }
  | { kind: "invalid-assistant"; value: string }
  | { kind: "missing-value"; flag: string }
  | { kind: "unknown"; flag: string };

function isLang(value: string | undefined): value is Lang {
  return value === "es" || value === "en";
}

function isAssistant(value: string | undefined): value is AssistantId {
  return value === "claude" || value === "codex";
}

export function resolveCliAction(argv: string[]): CliAction {
  const options: CliRunOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--version" || arg === "-v") return { kind: "version" };
    if (arg === "--lang" || arg.startsWith("--lang=")) {
      const value = arg.startsWith("--lang=") ? arg.slice("--lang=".length) : argv[++i] ?? "";
      if (!isLang(value)) return { kind: "invalid-lang", value };
      options.lang = value;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--non-interactive") {
      options.nonInteractive = true;
      continue;
    }
    if (arg === "--enrich") {
      options.enrich = true;
      continue;
    }
    if (arg === "--assistant" || arg.startsWith("--assistant=")) {
      const value = arg.startsWith("--assistant=") ? arg.slice("--assistant=".length) : argv[++i] ?? "";
      if (!isAssistant(value)) return { kind: "invalid-assistant", value };
      options.assistant = value;
      continue;
    }
    if (arg === "--model" || arg.startsWith("--model=")) {
      const value = arg.startsWith("--model=") ? arg.slice("--model=".length) : argv[++i] ?? "";
      if (value === "") return { kind: "missing-value", flag: "--model" };
      options.model = value;
      continue;
    }
    return { kind: "unknown", flag: arg };
  }
  return { kind: "run", ...options };
}

function usageWithAutomationOptions(ui: (typeof UI)[Lang]): string {
  return `${ui.usage}\n\n${ui.automationUsage}`;
}

export function getVersion(): string {
  // Works both from src/ (tests) and dist/ (published bin): ../package.json
  // resolves to packages/cli/package.json in either layout.
  const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
  return pkg.version;
}

export async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));
  const defaultLang = action.kind === "run" && action.lang ? action.lang : detectLang();
  let ui = UI[defaultLang];

  if (action.kind === "help") {
    console.log(usageWithAutomationOptions(ui));
    return;
  }
  if (action.kind === "version") {
    console.log(getVersion());
    return;
  }
  if (action.kind === "unknown") {
    console.error(`${ui.unknownOption(action.flag)}\n\n${usageWithAutomationOptions(ui)}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "invalid-lang") {
    console.error(`${ui.invalidLang(action.value)}\n\n${usageWithAutomationOptions(ui)}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "invalid-assistant") {
    console.error(`${ui.invalidAssistant(action.value)}\n\n${usageWithAutomationOptions(ui)}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "missing-value") {
    console.error(`${ui.missingFlagValue(action.flag)}\n\n${usageWithAutomationOptions(ui)}`);
    process.exitCode = 1;
    return;
  }

  const machineOutput = action.json === true;
  const planningOnly = action.dryRun === true || action.check === true;
  const nonInteractive = action.nonInteractive === true || machineOutput || planningOnly;
  // Enrichment output is non-deterministic, so --check (freshness comparison) must stay
  // on the deterministic baseline.
  const enrich = action.enrich === true && action.check !== true;
  if (action.enrich === true && action.check === true) console.warn("--enrich is ignored with --check.");

  if (!machineOutput) clack.intro("agent-rules-init");

  if (!machineOutput && !nonInteractive && !hasInteractiveTty()) {
    console.warn(ui.noTtyWarning);
  }

  try {
    const loadedConfig = loadConfig(process.cwd());
    const lang = action.lang ?? loadedConfig.config.lang ?? defaultLang;
    ui = UI[lang];
    if (!machineOutput) {
      for (const warning of loadedConfig.warnings) console.warn(warning);
    }
    let generatedFiles: readonly GeneratedFile[] = [];
    let repoFacts: RepoFacts | undefined;
    const results = await runCli(process.cwd(), {
      lang,
      config: loadedConfig.config,
      dryRun: planningOnly,
      nonInteractive,
      skipLlm: nonInteractive && !enrich,
      enrich,
      assistant: action.assistant,
      model: action.model,
      onGeneratedFiles: (files) => {
        generatedFiles = files;
      },
      onFacts: (facts) => {
        repoFacts = facts;
      },
    });
    const written = results.filter((r) => r.status === "written");
    const failures = results.filter((r) => r.status === "error");
    const outdated = action.check
      ? generatedFiles.filter((file) => {
          const absolutePath = path.join(process.cwd(), file.path);
          return fs.existsSync(absolutePath) && fs.readFileSync(absolutePath, "utf8") !== file.content;
        })
      : [];
    const checkIssues = written.length + outdated.length;

    if (machineOutput) {
      const contentByPath = new Map(generatedFiles.map((file) => [file.path, file.content]));
      console.log(
        JSON.stringify({
          mode: action.check ? "check" : action.dryRun ? "dry-run" : "write",
          configWarnings: loadedConfig.warnings,
          facts: repoFacts,
          wouldCreate: written.length,
          outdated: outdated.map((file) => file.path),
          results: results.map((result) => ({
            ...result,
            ...(planningOnly ? { content: contentByPath.get(result.path) } : {}),
          })),
        })
      );
    } else if (action.dryRun) {
      const statusByPath = new Map(results.map((result) => [result.path, result.status]));
      for (const file of generatedFiles) {
        console.log(`\n--- ${file.path} (${statusByPath.get(file.path) === "written" ? "would create" : "exists"}) ---\n${file.content}`);
      }
    } else if (!action.check) for (const result of results) {
      if (result.status === "written") {
        clack.log.success(result.path);
      } else if (result.status === "skipped") {
        clack.log.info(ui.fileSkipped(result.path));
      } else {
        clack.log.warn(`${result.path}: ${result.error}`);
      }
    }

    if (!machineOutput && action.check) {
      console.log(
        checkIssues > 0
          ? `${written.length} file(s) missing; ${outdated.length} file(s) outdated.`
          : "Generated files are present and up to date."
      );
    } else if (!machineOutput && action.dryRun) {
      console.log(`\n${written.length} file(s) would be generated.`);
    } else if (!machineOutput && written.length > 0) {
      clack.outro(ui.outroWritten);
    } else if (!machineOutput) {
      clack.outro(ui.outroNothing);
    }

    if (failures.length > 0 || (action.check && checkIssues > 0)) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = ui.unexpectedError((err as Error).message);
    if (machineOutput) {
      console.log(JSON.stringify({ mode: action.check ? "check" : action.dryRun ? "dry-run" : "write", error: message }));
    } else {
      clack.log.error(message);
    }
    process.exitCode = 1;
  }
}
