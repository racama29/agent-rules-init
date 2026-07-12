import fs from "node:fs";
import path from "node:path";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface WriteResult {
  path: string;
  status: "written" | "overwritten" | "skipped" | "error";
  error?: string;
}

export interface WriteOptions {
  /** Replace generated staging files, while never touching activated final files. */
  force?: boolean;
}

function isGeneratedPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((part) => part.includes(".generated."));
}

export function writeGeneratedFiles(
  rootPath: string,
  files: GeneratedFile[],
  options: WriteOptions = {}
): WriteResult[] {
  const realRoot = fs.realpathSync(rootPath);
  return files.map(({ path: relativePath, content }) => {
    const absolutePath = path.resolve(rootPath, relativePath);
    try {
      const lexicalFromRoot = path.relative(path.resolve(rootPath), absolutePath);
      if (lexicalFromRoot.startsWith("..") || path.isAbsolute(lexicalFromRoot)) {
        return { path: relativePath, status: "error", error: "refusing to write outside the repository root" };
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      const realParent = fs.realpathSync(path.dirname(absolutePath));
      const parentFromRoot = path.relative(realRoot, realParent);
      if (parentFromRoot.startsWith("..") || path.isAbsolute(parentFromRoot)) {
        return { path: relativePath, status: "error", error: "refusing to write outside the repository root" };
      }
      if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isSymbolicLink()) {
        return { path: relativePath, status: "error", error: "refusing to write through a symbolic link" };
      }
      if (options.force && fs.existsSync(absolutePath)) {
        if (!isGeneratedPath(relativePath)) {
          return { path: relativePath, status: "error", error: "refusing to overwrite a non-generated path" };
        }
        fs.writeFileSync(absolutePath, content);
        return { path: relativePath, status: "overwritten" };
      }
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
