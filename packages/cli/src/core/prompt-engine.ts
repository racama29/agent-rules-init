import * as clack from "@clack/prompts";
import { UI, detectLang, type Lang } from "./i18n.js";
import type { DetectionResult } from "./types.js";

export type QuestionField = "framework" | "testRunner" | "linter" | "packageManager";

export interface Question {
  packId: string;
  field: QuestionField;
  message: string;
}

const FIELDS: QuestionField[] = ["framework", "testRunner", "linter", "packageManager"];

export function collectLowConfidenceQuestions(detections: DetectionResult[], lang: Lang): Question[] {
  const ui = UI[lang];
  const questions: Question[] = [];
  for (const detection of detections) {
    for (const field of FIELDS) {
      const detectionField = detection[field];
      if (detectionField && detectionField.confidence === "low") {
        questions.push({
          packId: detection.packId,
          field,
          message: ui.question(ui.fieldLabels[field], detection.language),
        });
      }
    }
  }
  return questions;
}

export type PromptFn = (message: string) => Promise<string>;

export function hasInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function makeDefaultPromptFn(lang: Lang): PromptFn {
  return async (message) => {
    if (!hasInteractiveTty()) {
      console.warn(UI[lang].skippedQuestion(message));
      return "";
    }
    const answer = await clack.text({ message });
    if (clack.isCancel(answer)) {
      clack.cancel(UI[lang].cancelled);
      process.exit(1);
    }
    return answer;
  };
}

export const defaultPromptFn: PromptFn = (message) => makeDefaultPromptFn(detectLang())(message);

export async function askQuestions(
  questions: Question[],
  promptFn: PromptFn = defaultPromptFn
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    answers[`${question.packId}:${question.field}`] = await promptFn(question.message);
  }
  return answers;
}

export function applyAnswers(
  detections: DetectionResult[],
  answers: Record<string, string>
): DetectionResult[] {
  return detections.map((detection) => {
    const updated = { ...detection };
    for (const field of FIELDS) {
      const answer = answers[`${detection.packId}:${field}`];
      if (answer) {
        updated[field] = { value: answer, confidence: "high" };
      }
    }
    return updated;
  });
}
