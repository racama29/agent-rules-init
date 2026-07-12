import fs from "node:fs";
import path from "node:path";
import type { GeneratedFile } from "./writer.js";

const EXISTING_DOC_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/repository.mdc",
];
const MAX_EXISTING_DOC_CHARS = 20_000;

export function readExistingDocs(rootPath: string): GeneratedFile[] {
  const docs: GeneratedFile[] = [];
  for (const relativePath of EXISTING_DOC_PATHS) {
    const absolutePath = path.join(rootPath, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const content = fs.readFileSync(absolutePath, "utf8");
    if (content.trim() === "") continue;
    docs.push({ path: relativePath, content: content.slice(0, MAX_EXISTING_DOC_CHARS) });
  }
  return docs;
}
