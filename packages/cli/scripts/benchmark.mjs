import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const bin = path.join(packageRoot, "dist", "bin.js");
// npm injects a large npm_* environment into lifecycle scripts. It is not part of a
// normal installed CLI invocation and measurably distorts short process benchmarks.
const benchmarkEnv = Object.fromEntries(
  ["PATH", "HOME", "SystemRoot", "LANG", "LC_ALL"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]
  )
);
if (benchmarkEnv.PATH) {
  benchmarkEnv.PATH = benchmarkEnv.PATH
    .split(path.delimiter)
    .filter((entry) => !entry.endsWith(`${path.sep}node_modules${path.sep}.bin`))
    .join(path.delimiter);
}

function run(cwd) {
  return JSON.parse(execFileSync(process.execPath, [bin, "--dry-run", "--non-interactive", "--json"], {
    cwd,
    encoding: "utf8",
    env: benchmarkEnv,
  }));
}

const timings = [];
for (let index = 0; index < 7; index++) {
  const started = performance.now();
  run(path.join(repoRoot, "fixtures", "node-plain"));
  if (index > 0) timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);
const startupMedianMs = timings[Math.floor(timings.length / 2)];

const largeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-benchmark-"));
try {
  for (let index = 0; index < 10_000; index++) {
    const dir = path.join(largeRepo, "src", String(Math.floor(index / 100)));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `file-${index}.ts`), "export {};\n");
  }
  fs.writeFileSync(path.join(largeRepo, "package.json"), JSON.stringify({ type: "module" }));
  execFileSync("git", ["init", "--quiet"], { cwd: largeRepo });
  execFileSync("git", ["add", "."], { cwd: largeRepo });
  const large = run(largeRepo);
  const scan10kMs = large.scanStats.durationMs;
  if (startupMedianMs >= 120) throw new Error(`startup budget exceeded: ${startupMedianMs.toFixed(1)}ms`);
  if (scan10kMs >= 1_000) throw new Error(`10k-file scan budget exceeded: ${scan10kMs.toFixed(1)}ms`);
  console.log(JSON.stringify({
    startupMedianMs: Number(startupMedianMs.toFixed(1)),
    scan10kMs,
    files: large.scanStats.files,
  }));
} finally {
  fs.rmSync(largeRepo, { recursive: true, force: true });
}
