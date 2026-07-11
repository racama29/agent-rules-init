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
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      // `wx` makes the no-overwrite guarantee atomic: even if another process creates
      // the file between directory creation and this call, Node returns EEXIST.
      fs.writeFileSync(absolutePath, content, { flag: "wx" });
      return { path: relativePath, status: "written" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return { path: relativePath, status: "skipped" };
      }
      return { path: relativePath, status: "error", error: (err as Error).message };
    }
  });
}
