import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.resolve(packageRoot, "..", "..", "fixtures", "node-plain");
const binPath = path.join(packageRoot, "dist", "bin.js");
const assistant = process.argv[2] ?? "claude";
const model = process.argv[3];

if (assistant !== "claude" && assistant !== "codex") {
  throw new Error('assistant must be "claude" or "codex"');
}

function fixtureHash() {
  const hash = createHash("sha256");
  for (const name of fs.readdirSync(fixtureRoot).sort()) {
    const absolute = path.join(fixtureRoot, name);
    if (!fs.statSync(absolute).isFile()) continue;
    hash.update(name).update("\0").update(fs.readFileSync(absolute)).update("\0");
  }
  return hash.digest("hex");
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: fixtureRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`CLI exited ${code}: ${stderr}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

const before = fixtureHash();
const deterministic = await run(["--dry-run", "--json", "--non-interactive", "--lang", "en"]);
const enrichArgs = ["--dry-run", "--json", "--enrich", "--assistant", assistant, "--lang", "en"];
if (model) enrichArgs.push("--model", model);
const enriched = await run(enrichArgs);
const after = fixtureHash();

if (before !== after) throw new Error("read-only enrichment changed the fixture");
if (!enriched.enrichMetrics) throw new Error("enrichment metrics were not emitted");
if (enriched.enrichMetrics.fallbackBatches !== 0) throw new Error("enrichment fell back to deterministic output");
const deterministicByPath = new Map(deterministic.results.map((result) => [result.path, result.content]));
if (!enriched.results.some((result) => deterministicByPath.get(result.path) !== result.content)) {
  throw new Error("assistant returned no enriched content");
}

console.log(JSON.stringify({
  ok: true,
  assistant,
  model,
  fixture: "node-plain",
  metrics: enriched.enrichMetrics,
}));
