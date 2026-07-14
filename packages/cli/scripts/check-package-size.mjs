import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The optional maintainer interview is shipped as a lazy chunk. Keep the budget
// bounded while allowing that user-facing flow to remain self-contained.
const MAX_PACKED_BYTES = 48 * 1024;
// README, license and the 15 on-demand pack chunks are part of the public artifact.
// This is still roughly half the pre-bundle footprint while retaining every stack.
const MAX_UNPACKED_BYTES = 140 * 1024;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rules-init-size-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to check package size");

try {
  const result = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--json", "--pack-destination", temp], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: path.join(temp, "npm-cache") },
  }))[0];
  if (result.size > MAX_PACKED_BYTES || result.unpackedSize > MAX_UNPACKED_BYTES) {
    throw new Error(
      `package size budget exceeded: packed=${result.size}/${MAX_PACKED_BYTES}, unpacked=${result.unpackedSize}/${MAX_UNPACKED_BYTES}`
    );
  }
  console.log(`package size: ${(result.size / 1024).toFixed(1)} KB packed, ${(result.unpackedSize / 1024).toFixed(1)} KB unpacked`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
