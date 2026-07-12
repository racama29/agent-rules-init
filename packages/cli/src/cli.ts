import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import * as clack from "@clack/prompts";
import { scanRepo } from "./core/scanner.js";
import { scanRepoInWorker } from "./core/scanner-async.js";
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
import {
  hasInteractiveTty,
  type PromptFn,
} from "./core/prompt-engine.js";
import {
  detectAvailableAssistants,
  enrichFilesWithAssistant,
  estimateEnrichment,
  createDefaultExecFn,
  DEFAULT_EXEC_TIMEOUT_MS,
  summarizeEnrichmentChanges,
  type AssistantId,
  type EnrichMetrics,
  type ExecFn,
} from "./core/llm-bridge.js";
import type { RepoFacts, RepoSignals } from "./core/types.js";
import {
  hashGeneratedFiles,
  makeGenerationState,
  writeGenerationState,
  type EnrichmentState,
} from "./core/generation-state.js";
import { loadCachedEnrichment, makeEnrichmentState } from "./core/enrichment-cache.js";
import { evaluateGenerationCheck } from "./core/check-state.js";
import { applyGeneratedFiles, type ActivationResult } from "./core/activation.js";
import { ALL_PACKS, findPack } from "./packs/index.js";
import { readExistingDocs } from "./core/existing-docs.js";
import { resolveCliAction } from "./core/cli-options.js";
export { resolveCliAction } from "./core/cli-options.js";
export type { CliAction, CliRunOptions } from "./core/cli-options.js";

export interface RunCliOptions {
  /** @deprecated Project metadata is no longer requested interactively. */
  promptFn?: PromptFn;
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
  /** Offload repository traversal to a worker thread. Enabled by the published binary. */
  useScannerWorker?: boolean;
}

export async function runCli(rootPath: string, options: RunCliOptions = {}): Promise<WriteResult[]> {
  const loadedConfig = options.config ? { config: options.config, warnings: [] } : loadConfig(rootPath);
  const config = loadedConfig.config;
  options.onConfigWarnings?.(loadedConfig.warnings);
  const timeoutSeconds = options.enrichTimeoutSeconds ?? config.enrichTimeoutSeconds ?? DEFAULT_EXEC_TIMEOUT_MS / 1000;
  const execFn = options.execFn ?? createDefaultExecFn(timeoutSeconds * 1000);
  const lang = options.lang ?? config.lang ?? detectLang();
  const ui = UI[lang];

  const scanOptions = {
    maxDepth: config.scanMaxDepth,
    maxFiles: config.scanMaxFiles,
  };
  let scanned: RepoSignals;
  if (options.useScannerWorker) {
    try {
      scanned = await scanRepoInWorker(rootPath, scanOptions, (config.scanWorkerTimeoutSeconds ?? 30) * 1_000);
    } catch (error) {
      scanned = scanRepo(rootPath, scanOptions);
      scanned.scanWarnings = [
        ...(scanned.scanWarnings ?? []),
        `Scanner worker unavailable; used synchronous fallback: ${(error as Error).message}`,
      ];
      if (scanned.scanStats) scanned.scanStats.mode = "sync-fallback";
    }
  } else scanned = scanRepo(rootPath, scanOptions);
  const signals = applyProjectExcludes(scanned, config.exclude ?? []);
  options.onScanWarnings?.(signals.scanWarnings ?? []);
  if (signals.scanStats) options.onScanStats?.(signals.scanStats);
  const rawDetections = ALL_PACKS.map((pack) => pack.detect(signals)).filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  // Missing framework/tooling signals are valid facts, not questions the user should
  // have to answer. Keep the low-confidence `none` value and render conservative,
  // framework-neutral guidance; explicit repository config can still override project
  // metadata when a team wants to provide it.
  const detections = rawDetections;
  const facts = buildRepoFacts(signals, lang);
  options.onFacts?.(facts);
  const ctx = { facts, signals };

  const entries: RenderEntry[] = detections.map((detection) => {
    const pack = findPack(detection.packId);
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
    files.push({
      path: ".cursor/rules/repository.generated.mdc",
      content: renderCursorRules(entries, facts, lang),
    });
    files.push({ path: "GEMINI.generated.md", content: renderGeminiMd(entries, facts, lang) });
    for (const detection of detections) {
      const pack = findPack(detection.packId);
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
      },
      {
        path: ".cursor/rules/repository.generated.mdc",
        content: withFallback(renderCursorRules([], facts, lang)),
      },
      { path: "GEMINI.generated.md", content: withFallback(renderGeminiMd([], facts, lang)) }
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

  const wantsEnrich = (options.enrich ?? config.enrich) === true;
  const canOfferEnrich = !options.nonInteractive && hasInteractiveTty();
  if (!options.skipLlm && !config.noAi && (wantsEnrich || canOfferEnrich)) {
    // With --enrich there may be no TTY (scripts, CI); route progress through stderr so
    // stdout stays parseable in --json mode.
    const notify = canOfferEnrich ? (message: string) => clack.log.info(message) : (message: string) => console.warn(message);
    const assistants = await detectAvailableAssistants(execFn);
    const requested = options.assistant ?? config.assistant;
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
        const existingDocs = readExistingDocs(rootPath);
        const model = options.model ?? config.model;
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
          const spinner = canOfferEnrich ? clack.spinner() : undefined;
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
  // Enrichment output is non-deterministic, so --check (freshness comparison) must stay
  // on the deterministic baseline.
  if (!machineOutput) clack.intro("agent-rules-init");

  if (!machineOutput && !nonInteractive && !hasInteractiveTty()) {
    console.warn(ui.noTtyWarning);
  }

  try {
    const loadedConfig = loadConfig(process.cwd());
    const apply = action.apply === true && action.check !== true && action.dryRun !== true;
    const configuredEnrich = (action.enrich ?? loadedConfig.config.enrich) === true;
    const enrich = configuredEnrich && action.check !== true && !(apply && action.force !== true);
    const lang = action.lang ?? loadedConfig.config.lang ?? defaultLang;
    ui = UI[lang];
    if (action.enrich === true && action.check === true) console.warn(ui.enrichIgnoredWithCheck);
    if (action.force === true && action.check === true) console.warn(ui.forceIgnoredWithCheck);
    if (action.apply === true && !apply) console.warn(ui.applyIgnoredWithPlanning);
    if (!machineOutput) {
      for (const warning of loadedConfig.warnings) console.warn(warning);
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
      useScannerWorker: true,
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
          configWarnings: loadedConfig.warnings,
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
        if (result.status === "applied") clack.log.success(ui.fileApplied(result.activePath, result.backupPath));
        else if (result.status === "unchanged") clack.log.info(ui.fileAlreadyApplied(result.activePath));
        else if (result.status === "error") clack.log.warn(`${result.activePath}: ${result.error}`);
      }
    } else if (!action.check) for (const result of results) {
      if (result.status === "written" || result.status === "overwritten") {
        clack.log.success(result.path);
      } else if (result.status === "skipped") {
        clack.log.info(ui.fileSkipped(result.path));
      } else {
        clack.log.warn(`${result.path}: ${result.error}`);
      }
    }

    if (!machineOutput && enrichMetrics) clack.log.info(ui.enrichMetrics(enrichMetrics));

    if (!machineOutput && action.check) {
      console.log(
        checkIssues > 0
          ? ui.checkSummary(missing.length, outdated.length)
          : ui.checkOk
      );
    } else if (!machineOutput && action.dryRun) {
      console.log(`\n${ui.dryRunSummary(changed.length)}`);
    } else if (!machineOutput && apply) {
      clack.outro(ui.outroApplied);
    } else if (!machineOutput && changed.length > 0) {
      clack.outro(ui.outroWritten);
    } else if (!machineOutput) {
      clack.outro(ui.outroNothing);
    }

    if (failures.length > 0 || activationResults.some((result) => result.status === "error") || (action.check && checkIssues > 0)) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = ui.unexpectedError((err as Error).message);
    if (machineOutput) {
      console.log(JSON.stringify({ mode: action.check ? "check" : action.dryRun ? "dry-run" : action.apply ? "apply" : "write", error: message }));
    } else {
      clack.log.error(message);
    }
    process.exitCode = 1;
  }
}
