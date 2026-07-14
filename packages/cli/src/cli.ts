import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { MultiSelectOptions, SelectOptions } from "@clack/prompts";
import type * as Clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { writeGeneratedFiles, type GeneratedFile, type WriteResult } from "./core/writer.js";
import {
  renderClaudeMd,
  renderAgentsMd,
  renderCopilotInstructions,
  renderCursorRules,
  renderGeminiMd,
  renderPromptFiles,
  type RenderEntry,
} from "./core/templates.js";
import { buildRepoFacts } from "./core/repo-facts.js";
import { UI, detectLang, type Lang } from "./core/i18n.js";
import { loadConfig, type AgentRulesConfig } from "./core/config.js";
import { applyProjectExcludes, buildPackageUnits } from "./core/project-units.js";
import { renderProjectUnitAgents } from "./core/project-unit-output.js";
import { hasInteractiveTty } from "./core/prompt-engine.js";
import type { AssistantId, EnrichMetrics, ExecFn } from "./core/llm-bridge.js";
import type { RepoFacts, RepoSignals } from "./core/types.js";
import type { MaintainerIntent, TaskContext } from "./core/types.js";
import {
  hashGeneratedFiles,
  makeGenerationState,
  writeGenerationState,
  type EnrichmentState,
} from "./core/generation-state.js";
import { loadCachedEnrichment, makeEnrichmentState } from "./core/enrichment-cache.js";
import { evaluateGenerationCheck } from "./core/check-state.js";
import { applyGeneratedFiles, type ActivationResult } from "./core/activation.js";
import { loadCandidatePacks } from "./packs/index.js";
import { readExistingDocs } from "./core/existing-docs.js";
import { resolveCliAction } from "./core/cli-options.js";
import type { InterviewIo, InterviewOption } from "./core/interview.js";
import {
  loadContextFile,
  loadTaskContext,
  makeProjectContext,
  saveMaintainerIntent,
  saveTaskContext,
} from "./core/project-context.js";
export { resolveCliAction } from "./core/cli-options.js";
export type { CliAction, CliRunOptions } from "./core/cli-options.js";

const DEFAULT_ENRICH_TIMEOUT_MS = 300_000;

/** Stable low-cost defaults. Explicit --model/config values always take precedence. */
export const BASIC_ASSISTANT_MODELS: Record<AssistantId, string> = {
  claude: "haiku",
  codex: "gpt-5.4-mini",
};

function maintainerStatements(intent?: MaintainerIntent, task?: TaskContext): string[] {
  return [
    intent?.purpose,
    ...(intent?.priorities ?? []),
    ...(intent?.assistantRoles ?? []),
    ...(intent?.boundaries ?? []),
    ...(intent?.doneCriteria ?? []),
    ...(intent?.decisions ?? []),
    task?.goal,
    ...(task?.successCriteria ?? []),
    ...(task?.allowedPaths ?? []),
    ...(task?.restrictions ?? []),
  ].filter((value): value is string => Boolean(value));
}

export interface RunCliOptions {
  execFn?: ExecFn;
  skipLlm?: boolean;
  lang?: Lang;
  /** Generate results without changing the filesystem. */
  dryRun?: boolean;
  /** Replace only existing *.generated.* staging files. */
  force?: boolean;
  /** Do not prompt or offer AI enrichment. */
  nonInteractive?: boolean;
  /** Run AI enrichment without asking, even without a TTY. Ignored when skipLlm or noAi apply. */
  enrich?: boolean;
  /** Assistant to enrich with; defaults to the first one installed. */
  assistant?: AssistantId;
  /** Model forwarded verbatim to the assistant CLI; its default when omitted. */
  model?: string;
  /** Per-assistant-attempt timeout in seconds. */
  enrichTimeoutSeconds?: number;
  /** Disable reuse of verified enriched staging for this invocation. */
  noEnrichCache?: boolean;
  /** Number of retries after the first assistant attempt (0..2). */
  enrichRetries?: number;
  /** Maintainer context supplied by interview or portable context file. */
  intent?: MaintainerIntent;
  /** Current task supplied for this run or loaded from the local task file. */
  task?: TaskContext;
  /** Receives the rendered files before they are written (or planned). */
  onGeneratedFiles?: (files: readonly GeneratedFile[]) => void;
  /** Receives the deterministic generation fingerprint before optional enrichment. */
  onBaselineHash?: (hash: string) => void;
  onEnrichMetrics?: (metrics: EnrichMetrics) => void;
  /** Preloaded repository configuration; loaded from disk when omitted. */
  config?: AgentRulesConfig;
  onConfigWarnings?: (warnings: readonly string[]) => void;
  /** Receives the facts extracted from the repo (including canonical commands). */
  onFacts?: (facts: RepoFacts) => void;
  onScanWarnings?: (warnings: readonly string[]) => void;
  onScanStats?: (stats: NonNullable<RepoSignals["scanStats"]>) => void;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const loadedConfig = options.config ? { config: options.config, warnings: [] } : loadConfig(rootPath);
  const config = loadedConfig.config;
  options.onConfigWarnings?.(loadedConfig.warnings);
  const timeoutSeconds = options.enrichTimeoutSeconds ?? config.enrichTimeoutSeconds ?? DEFAULT_ENRICH_TIMEOUT_MS / 1000;
  const lang = options.lang ?? config.lang ?? detectLang();
  const ui = UI[lang];

  const scanOptions = {
    maxDepth: config.scanMaxDepth,
    maxFiles: config.scanMaxFiles,
  };
  const scanned: RepoSignals = scanRepo(rootPath, scanOptions);
  const signals = applyProjectExcludes(scanned, config.exclude ?? []);
  options.onScanWarnings?.(signals.scanWarnings ?? []);
  if (signals.scanStats) options.onScanStats?.(signals.scanStats);
  const candidatePacks = await loadCandidatePacks(signals);
  const rawDetections = candidatePacks.map((pack) => pack.detect(signals)).filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  // Missing framework/tooling signals are valid facts, not questions the user should
  // have to answer. Keep the low-confidence `none` value and render conservative,
  // framework-neutral guidance; explicit repository config can still override project
  // metadata when a team wants to provide it.
  const detections = rawDetections;
  const facts = buildRepoFacts(signals, lang);
  options.onFacts?.(facts);
  const projectContext = makeProjectContext(facts, config, options.task, options.intent);
  const ctx = { facts, signals };

  const detectedPacks = new Map(candidatePacks.map((pack) => [pack.id, pack]));
  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = detectedPacks.get(detection.packId)!;
    return { detection, ruleSet: pack.rules(detection, lang, ctx) };
  });

  const files: { path: string; content: string }[] = [];

  if (entries.length > 0) {
    files.push({ path: "CLAUDE.generated.md", content: renderClaudeMd(entries, projectContext, lang) });
    files.push({ path: "AGENTS.generated.md", content: renderAgentsMd(entries, projectContext, lang) });
    files.push({
      path: ".github/copilot-instructions.generated.md",
      content: renderCopilotInstructions(entries, projectContext, lang),
    });
    files.push({
      path: ".cursor/rules/repository.generated.mdc",
      content: renderCursorRules(entries, projectContext, lang),
    });
    files.push({ path: "GEMINI.generated.md", content: renderGeminiMd(entries, projectContext, lang) });
    for (const detection of detections) {
      const pack = detectedPacks.get(detection.packId)!;
      for (const file of renderPromptFiles(detection.packId, pack.promptTemplates(detection, lang, ctx), projectContext, lang)) {
        files.push(file);
      }
    }
  } else {
    const withFallback = (content: string) =>
      content.replace(ui.generatedHeader, `${ui.generatedHeader}\n\n${ui.noStackFallback}`);
    files.push(
      { path: "CLAUDE.generated.md", content: withFallback(renderClaudeMd([], projectContext, lang)) },
      { path: "AGENTS.generated.md", content: withFallback(renderAgentsMd([], projectContext, lang)) },
      {
        path: ".github/copilot-instructions.generated.md",
        content: withFallback(renderCopilotInstructions([], projectContext, lang)),
      },
      {
        path: ".cursor/rules/repository.generated.mdc",
        content: withFallback(renderCursorRules([], projectContext, lang)),
      },
      { path: "GEMINI.generated.md", content: withFallback(renderGeminiMd([], projectContext, lang)) }
    );
  }

  // Nested AGENTS files are intentionally limited to package-local facts and stack
  // signals. The root documents remain the cross-repository overview.
  for (const unit of buildPackageUnits(signals)) {
    const scoped = renderProjectUnitAgents(unit, lang, config.projects?.[unit.path]);
    if (scoped) files.push(scoped);
  }

  const baselineHash = hashGeneratedFiles(files);
  options.onBaselineHash?.(baselineHash);
  let acceptedEnrichmentState: EnrichmentState | undefined;

  const wantsEnrich = options.enrich === true;
  const interactiveOutput = !options.nonInteractive && hasInteractiveTty();
  if (!options.skipLlm && !config.noAi && wantsEnrich) {
    const {
      createDefaultExecFn,
      detectAvailableAssistants,
      enrichFilesWithAssistant,
      estimateEnrichment,
      summarizeEnrichmentChanges,
    } = await import("./core/llm-bridge.js");
    const execFn = options.execFn ?? createDefaultExecFn(timeoutSeconds * 1000);
    const enrichClack = interactiveOutput ? await import("@clack/prompts") : undefined;
    // With --enrich there may be no TTY (scripts, CI); route progress through stderr so
    // stdout stays parseable in --json mode.
    const notify = enrichClack ? (message: string) => enrichClack.log.info(message) : (message: string) => console.warn(message);
    const assistants = await detectAvailableAssistants(execFn);
    const requested = options.assistant ?? config.assistant;
    if (requested && !assistants.includes(requested)) {
      console.warn(ui.assistantNotAvailable(requested));
    } else if (assistants.length === 0) {
      console.warn(ui.enrichNoAssistant);
    } else {
      const chosenAssistant = requested ?? assistants[0];
      {
        const existingDocs = readExistingDocs(rootPath);
        let model = options.model ?? config.model;
        if (!model) {
          const basicModel = BASIC_ASSISTANT_MODELS[chosenAssistant];
          if (interactiveOutput && enrichClack) {
            const selected = await enrichClack.text({
              message: ui.enrichModelQuestion(chosenAssistant, basicModel),
              initialValue: basicModel,
              placeholder: basicModel,
            });
            model = enrichClack.isCancel(selected) || !selected.trim() ? basicModel : selected.trim();
          } else {
            model = basicModel;
          }
        }
        const requestedState = makeEnrichmentState(
          rootPath, signals.files, baselineHash, existingDocs, chosenAssistant, model
        );
        const useCache = options.noEnrichCache !== true && config.enrichCache !== false;
        const cached = useCache
          ? loadCachedEnrichment(rootPath, baselineHash, files, requestedState)
          : undefined;
        if (cached) {
          const changes = summarizeEnrichmentChanges(files, cached);
          options.onEnrichMetrics?.({
            assistant: chosenAssistant,
            model,
            batches: 0,
            attempts: 0,
            fallbackBatches: 0,
            inputChars: 0,
            outputChars: cached.reduce((sum, file) => sum + file.content.length, 0),
            durationMs: 0,
            cacheHit: true,
            ...changes,
            securityRejections: 0,
          });
          acceptedEnrichmentState = requestedState;
          files.splice(0, files.length, ...cached);
          notify(ui.enrichCacheHit);
        } else {
          const estimate = estimateEnrichment(files);
          if (estimate.batches > 1) notify(ui.enrichLargeInput(estimate.characters, estimate.batches));
          const spinner = enrichClack?.spinner();
          const retries = options.enrichRetries ?? config.enrichRetries ?? 1;
          notify(ui.enrichBudget(timeoutSeconds, retries + 1));
          if (spinner) spinner.start(ui.enrichWorking(chosenAssistant));
          else notify(ui.enrichWorking(chosenAssistant));
          let runMetrics: EnrichMetrics | undefined;
          const verifiedCommands = [...new Set([
            ...facts.canonical.map((entry) => entry.command),
            ...facts.commands.map((entry) => entry.invocation),
            ...facts.ciCommands.map((entry) => entry.command),
          ])];
          const enriched = await enrichFilesWithAssistant(chosenAssistant, files, {
            execFn,
            lang,
            cwd: rootPath,
            mustKeep: verifiedCommands,
            protectedStatements: maintainerStatements(projectContext.intent, projectContext.task),
            existingDocs,
            model,
            maxAttempts: retries + 1,
            onMetrics: (metrics) => {
              runMetrics = metrics;
              options.onEnrichMetrics?.(metrics);
            },
          });
          const changed = enriched.some((file, i) => file.content !== files[i].content);
          const outcome = changed ? ui.enrichDone : ui.enrichKept;
          if (spinner) spinner.stop(outcome);
          else notify(outcome);
          files.splice(0, files.length, ...enriched);
          if (changed && runMetrics && runMetrics.fallbackBatches === 0) {
            acceptedEnrichmentState = requestedState;
          } else if (!changed) {
            // Never cache a deterministic fallback as a successful enrichment.
            acceptedEnrichmentState = undefined;
          }
        }
      }
    }
  }

  options.onGeneratedFiles?.(files);
  if (options.dryRun) {
    return files.map((file) => ({
      path: file.path,
      status: fs.existsSync(path.join(rootPath, file.path))
        ? options.force ? "overwritten" : "skipped"
        : "written",
    }));
  }

  const results = writeGeneratedFiles(rootPath, files, { force: options.force });
  const completeRefresh = results.every((result) =>
    result.status === "written" || result.status === "overwritten"
  );
  if (completeRefresh) {
    writeGenerationState(rootPath, makeGenerationState(baselineHash, files, acceptedEnrichmentState));
  }
  return results;
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

interface ClackIo {
  select: typeof Clack.select;
  multiselect: typeof Clack.multiselect;
  text: typeof Clack.text;
  confirm: typeof Clack.confirm;
  note: typeof Clack.note;
  isCancel: typeof Clack.isCancel;
}

/** Wires the maintainer interview's IO contract to @clack/prompts. Exported for direct testing. */
export function createInterviewIo(clack: ClackIo, lang: Lang): InterviewIo {
  return {
    async select<T extends string>(options: {
      message: string; options: InterviewOption<T>[]; initialValue?: T;
    }) {
      const value = await clack.select<T>(options as SelectOptions<T>);
      return clack.isCancel(value) ? undefined : value;
    },
    async multiselect<T extends string>(options: {
      message: string; options: InterviewOption<T>[]; initialValues?: T[]; maxItems?: number; required?: boolean;
    }) {
      const value = await clack.multiselect<T>(options as MultiSelectOptions<T>);
      return clack.isCancel(value) ? undefined : value;
    },
    text: async (options) => {
      const value = await clack.text({
        message: options.message, placeholder: options.placeholder, initialValue: options.initialValue,
        // Without this, @clack/prompts resolves an empty submit to `undefined` —
        // indistinguishable from the user cancelling the whole interview with Ctrl-C.
        defaultValue: "",
        validate: (input) => {
          if (options.required && !input.trim()) return lang === "es" ? "Esta respuesta es obligatoria." : "This answer is required.";
          if (options.minLength && input.trim().length < options.minLength) {
            return lang === "es" ? `Escribe al menos ${options.minLength} caracteres.` : `Enter at least ${options.minLength} characters.`;
          }
          return undefined;
        },
      });
      return clack.isCancel(value) ? undefined : value;
    },
    confirm: async (options) => {
      const value = await clack.confirm(options);
      return clack.isCancel(value) ? undefined : value;
    },
    note: (message, title) => clack.note(message, title),
  };
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
  if (action.kind === "invalid-timeout") {
    console.error(`${ui.invalidTimeout(action.value)}\n\n${usageWithAutomationOptions(ui)}`);
    process.exitCode = 1;
    return;
  }
  if (action.kind === "invalid-retries") {
    console.error(`${ui.invalidRetries(action.value)}\n\n${usageWithAutomationOptions(ui)}`);
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
  const nonInteractive = action.nonInteractive === true || machineOutput || planningOnly || action.apply === true;
  if (action.interview && nonInteractive) {
    console.error("--interview requires an interactive terminal and cannot be combined with --json, --non-interactive, --check, --dry-run or --apply.");
    process.exitCode = 1;
    return;
  }
  if (action.interview && !hasInteractiveTty()) {
    console.error("--interview requires an interactive terminal.");
    process.exitCode = 1;
    return;
  }
  // Enrichment output is non-deterministic, so --check (freshness comparison) must stay
  // on the deterministic baseline.
  const clack = machineOutput ? undefined : await import("@clack/prompts");
  if (clack) clack.intro("agent-rules-init");

  try {
    let loadedConfig = loadConfig(process.cwd());
    const apply = action.apply === true && action.check !== true && action.dryRun !== true;
    const enrich = action.enrich === true && action.check !== true && !(apply && action.force !== true);
    const lang = action.lang ?? loadedConfig.config.lang ?? defaultLang;
    ui = UI[lang];
    let sessionIntent: MaintainerIntent | undefined;
    let sessionTask: TaskContext | undefined;
    const contextWarnings: string[] = [];
    if (action.contextFile) {
      const external = loadContextFile(path.resolve(process.cwd(), action.contextFile));
      sessionIntent = external.intent;
      sessionTask = external.task;
      contextWarnings.push(...external.warnings);
    } else {
      const localTask = loadTaskContext(process.cwd());
      sessionTask = localTask.task;
      contextWarnings.push(...localTask.warnings);
    }
    if (action.interview) {
      const { runContextInterview } = await import("./core/interview.js");
      const previewSignals = scanRepo(process.cwd(), {
        maxDepth: loadedConfig.config.scanMaxDepth,
        maxFiles: loadedConfig.config.scanMaxFiles,
      });
      const previewPacks = await loadCandidatePacks(previewSignals);
      const stacks = previewPacks
        .map((pack) => pack.detect(previewSignals))
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .map((detection) => detection.language);
      const previewFacts = buildRepoFacts(previewSignals, lang);
      const interviewIo: InterviewIo = createInterviewIo(clack!, lang);
      const interview = await runContextInterview(interviewIo, lang, {
        stacks: [...new Set(stacks)],
        canonicalCommands: previewFacts.canonical
          .filter((command) => command.confidence === "high")
          .map((command) => command.command),
      }, sessionIntent ?? loadedConfig.config.intent);
      if (interview.cancelled) {
        clack!.cancel(ui.cancelled);
        return;
      }
      if (interview.intent) {
        saveMaintainerIntent(process.cwd(), interview.intent);
        sessionIntent = interview.intent;
        loadedConfig = loadConfig(process.cwd());
      }
      sessionTask = interview.task;
      if (interview.task && interview.persistTask) saveTaskContext(process.cwd(), interview.task);
    }
    if (action.enrich === true && action.check === true) console.warn(ui.enrichIgnoredWithCheck);
    if (action.force === true && action.check === true) console.warn(ui.forceIgnoredWithCheck);
    if (action.apply === true && !apply) console.warn(ui.applyIgnoredWithPlanning);
    if (!machineOutput) {
      for (const warning of [...loadedConfig.warnings, ...contextWarnings]) console.warn(warning);
    }
    let generatedFiles: readonly GeneratedFile[] = [];
    let repoFacts: RepoFacts | undefined;
    let baselineHash: string | undefined;
    let enrichMetrics: EnrichMetrics | undefined;
    let scanWarnings: readonly string[] = [];
    let scanStats: RepoSignals["scanStats"];
    const results = await runCli(process.cwd(), {
      lang,
      config: loadedConfig.config,
      dryRun: planningOnly || (apply && action.force !== true),
      force: action.force === true && action.check !== true,
      nonInteractive,
      skipLlm: nonInteractive && !enrich,
      enrich,
      assistant: action.assistant ?? loadedConfig.config.assistant,
      model: action.model ?? loadedConfig.config.model,
      enrichTimeoutSeconds: action.enrichTimeoutSeconds ?? loadedConfig.config.enrichTimeoutSeconds,
      noEnrichCache: action.noEnrichCache === true,
      enrichRetries: action.enrichRetries ?? loadedConfig.config.enrichRetries,
      intent: sessionIntent,
      task: sessionTask,
      onGeneratedFiles: (files) => {
        generatedFiles = files;
      },
      onBaselineHash: (hash) => {
        baselineHash = hash;
      },
      onEnrichMetrics: (metrics) => {
        enrichMetrics = metrics;
      },
      onFacts: (facts) => {
        repoFacts = facts;
      },
      onScanWarnings: (warnings) => {
        scanWarnings = warnings;
      },
      onScanStats: (stats) => {
        scanStats = stats;
      },
    });
    if (!machineOutput) for (const warning of scanWarnings) console.warn(warning);
    let activationResults: ActivationResult[] = [];
    if (apply) {
      if (!baselineHash) throw new Error("generation baseline was not produced");
      activationResults = applyGeneratedFiles(process.cwd(), generatedFiles, baselineHash);
    }
    const written = results.filter((r) => r.status === "written");
    const overwritten = results.filter((r) => r.status === "overwritten");
    const changed = [...written, ...overwritten];
    const failures = results.filter((r) => r.status === "error");
    const check = action.check
      ? evaluateGenerationCheck(process.cwd(), generatedFiles, baselineHash)
      : { baselineMatches: undefined, recordedBaselineHash: undefined, fileStates: [], missing: [], outdated: [] };
    const { fileStates, missing, outdated } = check;
    const checkIssues = missing.length + outdated.length;

    if (machineOutput) {
      const contentByPath = new Map(generatedFiles.map((file) => [file.path, file.content]));
      console.log(
        JSON.stringify({
          mode: action.check ? "check" : action.dryRun ? "dry-run" : apply ? "apply" : "write",
          configWarnings: [...loadedConfig.warnings, ...contextWarnings],
          scanWarnings,
          scanStats,
          facts: repoFacts,
          wouldCreate: action.check ? missing.length : written.length,
          missing: missing.map((file) => file.path),
          outdated: outdated.map((file) => file.path),
          baselineCurrent: check.baselineMatches,
          baselineHash,
          recordedBaselineHash: check.recordedBaselineHash,
          fileStates,
          activationResults,
          enrichMetrics,
          results: results.map((result) => ({
            ...result,
            ...(planningOnly ? { content: contentByPath.get(result.path) } : {}),
          })),
        })
      );
    } else if (action.dryRun) {
      const statusByPath = new Map(results.map((result) => [result.path, result.status]));
      for (const file of generatedFiles) {
        const status = statusByPath.get(file.path);
        const label = ui.dryRunFileLabel(status);
        console.log(`\n--- ${file.path} (${label}) ---\n${file.content}`);
      }
    } else if (apply) {
      for (const result of activationResults) {
        if (result.status === "applied") clack!.log.success(ui.fileApplied(result.activePath, result.backupPath));
        else if (result.status === "unchanged") clack!.log.info(ui.fileAlreadyApplied(result.activePath));
        else if (result.status === "error") clack!.log.warn(`${result.activePath}: ${result.error}`);
      }
    } else if (!action.check) for (const result of results) {
      if (result.status === "written" || result.status === "overwritten") {
        clack!.log.success(result.path);
      } else if (result.status === "skipped") {
        clack!.log.info(ui.fileSkipped(result.path));
      } else {
        clack!.log.warn(`${result.path}: ${result.error}`);
      }
    }

    if (!machineOutput && enrichMetrics) clack!.log.info(ui.enrichMetrics(enrichMetrics));

    if (!machineOutput && action.check) {
      console.log(
        checkIssues > 0
          ? ui.checkSummary(missing.length, outdated.length)
          : ui.checkOk
      );
    } else if (!machineOutput && action.dryRun) {
      console.log(`\n${ui.dryRunSummary(changed.length)}`);
    } else if (!machineOutput && apply) {
      clack!.outro(ui.outroApplied);
    } else if (!machineOutput && changed.length > 0) {
      clack!.outro(ui.outroWritten);
    } else if (!machineOutput) {
      clack!.outro(ui.outroNothing);
    }

    if (failures.length > 0 || activationResults.some((result) => result.status === "error") || (action.check && checkIssues > 0)) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = ui.unexpectedError((err as Error).message);
    if (machineOutput) {
      console.log(JSON.stringify({ mode: action.check ? "check" : action.dryRun ? "dry-run" : action.apply ? "apply" : "write", error: message }));
    } else {
      clack!.log.error(message);
    }
    process.exitCode = 1;
  }
}
