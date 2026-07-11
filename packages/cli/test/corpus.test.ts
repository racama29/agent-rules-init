import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";
import type { Lang } from "../src/core/i18n.js";

const FIXTURES_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");

const CORPUS = [
  "node-express-mocha",
  "python-uv-tox",
  "java-spring-maven",
  "node-react-vitest",
  "python-fastapi",
  "monorepo-js-python",
] as const;

async function renderCorpus(fixture: string, lang: Lang): Promise<Map<string, string>> {
  let generated: readonly GeneratedFile[] = [];
  await runCli(path.join(FIXTURES_ROOT, fixture), {
    lang,
    dryRun: true,
    nonInteractive: true,
    skipLlm: true,
    onGeneratedFiles: (files) => {
      generated = files;
    },
  });
  return new Map(generated.map((f) => [f.path, f.content]));
}

describe("corpus snapshots", () => {
  for (const fixture of CORPUS) {
    for (const lang of ["es", "en"] as const) {
      it(`${fixture} (${lang})`, async () => {
        const files = await renderCorpus(fixture, lang);
        expect(Object.fromEntries(files)).toMatchSnapshot();
      });
    }
  }

  it("produces identical output across two runs", async () => {
    const first = await renderCorpus("node-express-mocha", "en");
    const second = await renderCorpus("node-express-mocha", "en");
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  });
});
