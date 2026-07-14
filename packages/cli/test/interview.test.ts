import { describe, expect, it } from "vitest";
import { runContextInterview, type InterviewIo } from "../src/core/interview.js";

function fakeIo(answers: unknown[]): InterviewIo & { notes: string[] } {
  const next = async () => answers.shift() as never;
  const notes: string[] = [];
  return {
    select: next, multiselect: next, text: next, confirm: next,
    note: (message) => { notes.push(message); }, notes,
  };
}

describe("context interview", () => {
  it("collects durable intent and a temporary task with an explicit persistence choice", async () => {
    const io = fakeIo([
      "both",
      "A CLI that gives maintainers reliable AI project guidance.",
      ["correctness", "compatibility"],
      ["implementation", "testing"],
      "plan-first",
      "Do not change the public API; Do not add dependencies",
      "Tests pass; Documentation stays aligned",
      "Node 18 remains supported",
      "Reduce startup latency below the agreed budget.",
      "Median below 100 ms; No regressions",
      "packages/cli/**",
      "ask",
      "Do not publish",
      false,
      true,
    ]);
    const result = await runContextInterview(io, "en", {
      stacks: ["TypeScript/JavaScript"], canonicalCommands: ["npm test"],
    });
    expect(result).toMatchObject({
      cancelled: false,
      persistTask: false,
      intent: {
        purpose: "A CLI that gives maintainers reliable AI project guidance.",
        priorities: ["correctness", "compatibility"],
        boundaries: ["Do not change the public API", "Do not add dependencies"],
      },
      task: { goal: "Reduce startup latency below the agreed budget.", fallback: "ask" },
    });
    expect(io.notes[0]).toContain("npm test");
  });

  it("can collect only a task without replacing permanent intent", async () => {
    const io = fakeIo(["task", "Improve documentation quality.", "Examples are current", "", "conservative", "", true, true]);
    const result = await runContextInterview(io, "en", { stacks: [], canonicalCommands: [] });
    expect(result.intent).toBeUndefined();
    expect(result.task?.goal).toBe("Improve documentation quality.");
    expect(result.persistTask).toBe(true);
  });

  it("cancels cleanly at any question", async () => {
    const result = await runContextInterview(fakeIo([undefined]), "es", { stacks: [], canonicalCommands: [] });
    expect(result).toEqual({ persistTask: false, cancelled: true });
  });
});
