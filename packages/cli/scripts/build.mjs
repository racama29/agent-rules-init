import fs from "node:fs";
import { URL } from "node:url";
import { build } from "esbuild";

fs.rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  minify: true,
  sourcemap: false,
  packages: "external",
  charset: "utf8",
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: { bin: "src/bin.ts" },
  outdir: "dist",
  splitting: true,
  chunkNames: "packs/[name]-[hash]",
  legalComments: "none",
});
