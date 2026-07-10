import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeGeneratedFiles } from "../src/core/writer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-writer-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeGeneratedFiles", () => {
  it("writes each file under the root path, creating nested directories", () => {
    const results = writeGeneratedFiles(tmpDir, [
      { path: "CLAUDE.generated.md", content: "hello" },
      { path: ".claude/commands/review.generated.md", content: "review body" },
    ]);
    expect(results.every((r) => r.status === "written")).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8")).toBe("hello");
    expect(fs.readFileSync(path.join(tmpDir, ".claude/commands/review.generated.md"), "utf-8")).toBe(
      "review body"
    );
  });

  it("never overwrites an existing file, reporting it as skipped (not an error)", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "already here");
    const results = writeGeneratedFiles(tmpDir, [{ path: "CLAUDE.generated.md", content: "new content" }]);
    expect(results[0].status).toBe("skipped");
    expect(results[0].error).toBeUndefined();
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "utf-8")).toBe("already here");
  });

  it("continues writing remaining files after skipping an existing one", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.generated.md"), "already here");
    const results = writeGeneratedFiles(tmpDir, [
      { path: "CLAUDE.generated.md", content: "new content" },
      { path: "AGENTS.generated.md", content: "agents content" },
    ]);
    expect(results[0].status).toBe("skipped");
    expect(results[1].status).toBe("written");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.generated.md"), "utf-8")).toBe("agents content");
  });
});
