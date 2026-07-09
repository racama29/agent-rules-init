import * as clack from "@clack/prompts";
import type { DetectionResult } from "./types.js";

export type QuestionField = "framework" | "testRunner" | "linter" | "packageManager";

export interface Question {
  packId: string;
  field: QuestionField;
  message: string;
}

const FIELDS: QuestionField[] = ["framework", "testRunner", "linter", "packageManager"];

export function collectLowConfidenceQuestions(detections: DetectionResult[]): Question[] {
  const questions: Question[] = [];
  for (const detection of detections) {
    for (const field of FIELDS) {
      const detectionField = detection[field];
      if (detectionField && detectionField.confidence === "low") {
        questions.push({
          packId: detection.packId,
          field,
          message: `No se pudo determinar el ${field} para ${detection.language}. ¿Cuál usáis?`,
        });
      }
    }
  }
  return questions;
}

export type PromptFn = (message: string) => Promise<string>;

export const defaultPromptFn: PromptFn = async (message) => {
  const answer = await clack.text({ message });
  return typeof answer === "string" ? answer : "";
};

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
