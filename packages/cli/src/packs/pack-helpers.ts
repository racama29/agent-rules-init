import type { DetectionField } from "../core/types.js";

export type NamedSignal = readonly [needle: string, label: string];

export function detectNamedSignal(source: string, table: readonly NamedSignal[]): DetectionField<string> {
  const lower = source.toLowerCase();
  const match = table.find(([needle]) => lower.includes(needle));
  return match
    ? { value: match[1], confidence: "high" }
    : { value: "none", confidence: "low" };
}

export function detectedName(field: DetectionField<string> | undefined): string | undefined {
  return field?.value && field.value !== "none" ? field.value : undefined;
}
