import type { Lang } from "./i18n.js";
import type { AssistantId } from "./llm-bridge.js";

export interface CliRunOptions {
  lang?: Lang;
  dryRun?: true;
  force?: true;
  apply?: true;
  check?: true;
  json?: true;
  nonInteractive?: true;
  enrich?: true;
  assistant?: AssistantId;
  model?: string;
  enrichTimeoutSeconds?: number;
  noEnrichCache?: true;
  enrichRetries?: number;
}

export type CliAction =
  | ({ kind: "run" } & CliRunOptions)
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "invalid-lang"; value: string }
  | { kind: "invalid-assistant"; value: string }
  | { kind: "invalid-timeout"; value: string }
  | { kind: "invalid-retries"; value: string }
  | { kind: "missing-value"; flag: string }
  | { kind: "unknown"; flag: string };

function optionValue(argv: string[], index: number, name: string): [string, number] {
  const argument = argv[index];
  return argument.startsWith(`${name}=`)
    ? [argument.slice(name.length + 1), index]
    : [argv[index + 1] ?? "", index + 1];
}

export function resolveCliAction(argv: string[]): CliAction {
  const options: CliRunOptions = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { kind: "help" };
    if (argument === "--version" || argument === "-v") return { kind: "version" };
    if (argument === "--lang" || argument.startsWith("--lang=")) {
      const [value, consumed] = optionValue(argv, index, "--lang"); index = consumed;
      if (value !== "es" && value !== "en") return { kind: "invalid-lang", value };
      options.lang = value; continue;
    }
    if (argument === "--assistant" || argument.startsWith("--assistant=")) {
      const [value, consumed] = optionValue(argv, index, "--assistant"); index = consumed;
      if (value !== "claude" && value !== "codex") return { kind: "invalid-assistant", value };
      options.assistant = value; continue;
    }
    if (argument === "--model" || argument.startsWith("--model=")) {
      const [value, consumed] = optionValue(argv, index, "--model"); index = consumed;
      if (!value) return { kind: "missing-value", flag: "--model" };
      options.model = value; continue;
    }
    if (argument === "--enrich-timeout" || argument.startsWith("--enrich-timeout=")) {
      const [value, consumed] = optionValue(argv, index, "--enrich-timeout"); index = consumed;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 10 || parsed > 3600) return { kind: "invalid-timeout", value };
      options.enrichTimeoutSeconds = parsed; continue;
    }
    if (argument === "--enrich-retries" || argument.startsWith("--enrich-retries=")) {
      const [value, consumed] = optionValue(argv, index, "--enrich-retries"); index = consumed;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) return { kind: "invalid-retries", value };
      options.enrichRetries = parsed; continue;
    }
    const booleanOptions: Record<string, keyof CliRunOptions> = {
      "--dry-run": "dryRun", "--force": "force", "--apply": "apply", "--check": "check",
      "--json": "json", "--non-interactive": "nonInteractive", "--enrich": "enrich",
      "--no-enrich-cache": "noEnrichCache",
    };
    const key = booleanOptions[argument];
    if (key) { Object.assign(options, { [key]: true }); continue; }
    return { kind: "unknown", flag: argument };
  }
  return { kind: "run", ...options };
}
