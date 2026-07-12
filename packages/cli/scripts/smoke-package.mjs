import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to smoke-test the packed artifact");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-pack-"));
const npmEnv = { ...process.env, npm_config_cache: path.join(tempRoot, "npm-cache") };

try {
  // Invoke npm's JavaScript entrypoint through the current Node executable. Calling
  // npm.cmd directly through execFileSync produces EINVAL on Windows without a shell.
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--json", "--pack-destination", tempRoot], {
    cwd: packageRoot, encoding: "utf8", env: npmEnv,
  }));
  const tarball = path.join(tempRoot, packed[0].filename);
  const files = new Set(packed[0].files.map((entry) => entry.path));
  for (const required of ["dist/bin.js", "dist/cli.js", "dist/cli.d.ts", "package.json", "README.md", "LICENSE"]) {
    if (!files.has(required)) throw new Error(`packed artifact is missing ${required}`);
  }
  if ([...files].some((file) => file.startsWith("src/") || file.startsWith("test/"))) {
    throw new Error("packed artifact contains source or test files");
  }

  execFileSync("tar", ["-xf", tarball, "-C", tempRoot]);
  const unpackedRoot = path.join(tempRoot, "package");
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(unpackedRoot, "node_modules"), "junction");
  const binPath = path.join(unpackedRoot, "dist", "bin.js");
  const firstLine = fs.readFileSync(binPath, "utf8").split(/\r?\n/, 1)[0];
  if (firstLine !== "#!/usr/bin/env node") throw new Error("published binary has no Node shebang");
  const version = execFileSync(process.execPath, [binPath, "--version"], { encoding: "utf8" }).trim();
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (version !== manifest.version) throw new Error(`binary reports ${version}, expected ${manifest.version}`);
  const dryRun = JSON.parse(execFileSync(process.execPath, [binPath, "--dry-run", "--non-interactive", "--json"], {
    cwd: path.join(repoRoot, "fixtures", "node-plain"), encoding: "utf8",
  }));
  if (dryRun.scanStats?.mode !== "worker") throw new Error("published CLI did not scan in a worker thread");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
