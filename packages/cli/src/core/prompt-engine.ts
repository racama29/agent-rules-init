/**
 * Kept as a compatibility type for callers that supplied a custom clarification
 * prompt before 0.6.2. Project metadata is no longer requested interactively.
 */
export type PromptFn = (message: string) => Promise<string>;

export function hasInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
