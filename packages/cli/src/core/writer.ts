import fs from "node:fs";
import path from "node:path";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface WriteResult {
  path: string;
  status: "written" | "skipped" | "error";
  error?: string;
}

export function writeGeneratedFiles(rootPath: string, files: GeneratedFile[]): WriteResult[] {
  return files.map(({ path: relativePath, content }) => {
    const absolutePath = path.join(rootPath, relativePath);
    try {
      // An already-existing file is the expected outcome on a re-run (the tool's
      // no-overwrite guarantee), not a failure — report it as skipped, exit 0.
      if (fs.existsSync(absolutePath)) {
        return { path: relativePath, status: "skipped" };
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
      return { path: relativePath, status: "written" };
    } catch (err) {
      return { path: relativePath, status: "error", error: (err as Error).message };
    }
  });
}
