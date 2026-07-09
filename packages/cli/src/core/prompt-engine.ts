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

export function hasInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export const defaultPromptFn: PromptFn = async (message) => {
  if (!hasInteractiveTty()) {
    console.warn(
      `No se detectó una terminal interactiva; se omite la pregunta "${message}" y se usa el valor detectado.`
    );
    return "";
  }
  const answer = await clack.text({ message });
  if (clack.isCancel(answer)) {
    clack.cancel("Operación cancelada.");
    process.exit(1);
  }
  return answer;
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
