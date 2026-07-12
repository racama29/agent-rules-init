import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintRepository } from "../src/core/enrichment-cache.js";

describe("enrichment repository fingerprint", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-cache-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects same-size content changes even when mtime is restored", () => {
    const source = path.join(root, "source.ts");
    fs.writeFileSync(source, "aaa");
    const originalStat = fs.statSync(source);
    const before = fingerprintRepository(root, ["source.ts"]);

    fs.writeFileSync(source, "bbb");
    fs.utimesSync(source, originalStat.atime, originalStat.mtime);

    expect(fingerprintRepository(root, ["source.ts"])).not.toBe(before);
  });

  it("ignores generated artifacts so recording a result does not invalidate it", () => {
    fs.writeFileSync(path.join(root, "source.ts"), "source");
    fs.writeFileSync(path.join(root, "CLAUDE.generated.md"), "first");
    const before = fingerprintRepository(root, ["source.ts", "CLAUDE.generated.md"]);
    fs.writeFileSync(path.join(root, "CLAUDE.generated.md"), "second");
    expect(fingerprintRepository(root, ["source.ts", "CLAUDE.generated.md"])).toBe(before);
  });
});
