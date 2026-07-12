import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepo } from "../src/core/scanner.js";
import { writeGeneratedFiles } from "../src/core/writer.js";

function temporaryRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("adversarial repository inputs", () => {
  it("keeps discovery deterministic regardless of creation order", () => {
    const roots = [temporaryRepo("agent-rules-order-a-"), temporaryRepo("agent-rules-order-b-")];
    const files = ["z/package.json", "a/package.json", "m/tsconfig.json", "Unicode-ñ/README.md"];
    try {
      for (const [index, root] of roots.entries()) {
        const ordered = index === 0 ? files : [...files].reverse();
        for (const relative of ordered) {
          const target = path.join(root, relative);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, relative.endsWith("package.json") ? "{}" : relative);
        }
      }
      expect(scanRepo(roots[0]).files).toEqual(scanRepo(roots[1]).files);
    } finally {
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never writes randomized traversal paths outside the repository", () => {
    const root = temporaryRepo("agent-rules-traversal-");
    try {
      for (let index = 0; index < 50; index++) {
        const traversal = `${Array.from({ length: 1 + (index % 8) }, () => "..").join("/")}/escape-${index}.generated.md`;
        expect(writeGeneratedFiles(root, [{ path: traversal, content: "unsafe" }])[0].status).toBe("error");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans a large synthetic repository within a bounded budget", () => {
    const root = temporaryRepo("agent-rules-large-");
    try {
      // File creation/removal is setup, not scanner performance. Keep it large enough
      // to expose traversal regressions while remaining practical on Windows/NTFS CI.
      const syntheticFileCount = 750;
      for (let index = 0; index < syntheticFileCount; index++) {
        const dir = path.join(root, "packages", `package-${Math.floor(index / 25)}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `file-${index}.ts`), "export {};\n");
      }
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
      const started = performance.now();
      const signals = scanRepo(root, { maxFiles: 1_000 });
      const scanDurationMs = performance.now() - started;
      expect(signals.files).toHaveLength(syntheticFileCount + 1);
      expect(signals.scanStats).toMatchObject({ files: syntheticFileCount + 1, truncated: false });
      expect(signals.scanStats?.durationMs).toBeGreaterThanOrEqual(0);
      expect(scanDurationMs).toBeLessThan(3_000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
