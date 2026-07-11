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
  "node-plain",
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

describe("content quality gates", () => {
  it("Express, Flask and Petclinic fixtures produce clearly distinct rules", async () => {
    const express = await renderCorpus("node-express-mocha", "en");
    const flask = await renderCorpus("python-uv-tox", "en");
    const petclinic = await renderCorpus("java-spring-maven", "en");
    const claude = (m: Map<string, string>) => m.get("CLAUDE.generated.md")!;
    expect(claude(express)).not.toBe(claude(flask));
    expect(claude(flask)).not.toBe(claude(petclinic));
    expect(claude(express)).toContain("npm test");
    expect(claude(flask)).toContain("uv run pytest");
    expect(claude(petclinic)).toContain("./mvnw");
  });

  it("every review prompt in the corpus contains at least one backticked command", async () => {
    for (const fixture of ["node-express-mocha", "python-uv-tox", "java-spring-maven"] as const) {
      const files = await renderCorpus(fixture, "en");
      const reviews = [...files.entries()].filter(([p]) => p.includes("-review.generated"));
      expect(reviews.length).toBeGreaterThan(0);
      for (const [, content] of reviews) {
        expect(content).toMatch(/`[^`]+`/);
      }
    }
  });

  it("a plain JavaScript fixture never mentions TypeScript", async () => {
    const files = await renderCorpus("node-express-mocha", "en");
    for (const [, content] of files) {
      expect(content).not.toMatch(/TypeScript/);
    }
  });
});
