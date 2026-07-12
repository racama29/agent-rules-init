import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGeneratedFiles } from "../src/core/activation.js";
import {
  hashContent,
  loadGenerationState,
  makeGenerationState,
  writeGenerationState,
} from "../src/core/generation-state.js";

let tmpDir: string;
const files = [{ path: "CLAUDE.generated.md", content: "generated rules\n" }];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-apply-"));
  fs.writeFileSync(path.join(tmpDir, files[0].path), files[0].content);
  writeGenerationState(tmpDir, makeGenerationState("baseline", files));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("applyGeneratedFiles", () => {
  it("activates a reviewed staging file", () => {
    const results = applyGeneratedFiles(tmpDir, files, "baseline");
    expect(results[0]).toEqual(expect.objectContaining({ status: "applied", activePath: "CLAUDE.md" }));
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf8")).toBe("generated rules\n");
  });

  it("backs up an existing final file before replacing it", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "manual old rules\n");
    const [result] = applyGeneratedFiles(tmpDir, files, "baseline", new Date("2026-07-12T12:00:00Z"));
    expect(result.status).toBe("applied");
    expect(result.backupPath).toContain(".agent-rules-init/backups/2026-07-12T12-00-00-000Z/CLAUDE.md");
    expect(fs.readFileSync(path.join(tmpDir, result.backupPath!), "utf8")).toBe("manual old rules\n");
    expect(fs.readFileSync(path.join(tmpDir, ".agent-rules-init", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("records reviewed manual edits as the accepted active output", () => {
    fs.writeFileSync(path.join(tmpDir, files[0].path), "reviewed custom rules\n");
    applyGeneratedFiles(tmpDir, files, "baseline");
    expect(loadGenerationState(tmpDir)?.outputHashes[files[0].path]).toBe(
      hashContent("reviewed custom rules\n")
    );
  });

  it("refuses activation when the repository baseline changed", () => {
    expect(() => applyGeneratedFiles(tmpDir, files, "different-baseline")).toThrow(
      "repository changed since generation"
    );
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
  });
});
