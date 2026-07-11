import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";

const FIXTURES_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");
const SENTINELS = [
  "the project's framework",
  "el framework del proyecto",
  "the project's test runner",
  "el test runner del proyecto",
];
const CORPUS = [
  "node-express-mocha",
  "python-uv-tox",
  "java-spring-maven",
  "node-react-vitest",
  "python-fastapi",
  "monorepo-js-python",
] as const;

describe("generated content contains no vague sentinels", () => {
  for (const fixture of CORPUS) {
    for (const lang of ["es", "en"] as const) {
      it(`${fixture} (${lang})`, async () => {
        let generated: readonly GeneratedFile[] = [];
        await runCli(path.join(FIXTURES_ROOT, fixture), {
          lang, dryRun: true, nonInteractive: true, skipLlm: true,
          onGeneratedFiles: (files) => { generated = files; },
        });
        for (const file of generated) {
          for (const sentinel of SENTINELS) {
            expect(file.content, `${file.path} contiene "${sentinel}"`).not.toContain(sentinel);
          }
        }
      });
    }
  }
});
