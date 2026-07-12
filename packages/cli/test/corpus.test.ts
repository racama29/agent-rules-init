import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { GeneratedFile } from "../src/core/writer.js";
import type { Lang } from "../src/core/i18n.js";
import { CORPUS_QUALITY_CASES } from "./corpus-quality-cases.js";

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
  it("meets the versioned corpus quality score", async () => {
    let earned = 0;
    let available = 0;
    const failures: string[] = [];
    for (const qualityCase of CORPUS_QUALITY_CASES) {
      const files = await renderCorpus(qualityCase.fixture, "en");
      const output = [...files.values()].join("\n");
      for (const term of qualityCase.requiredTerms) {
        available++;
        if (output.includes(term)) earned++;
        else failures.push(`${qualityCase.fixture}: missing ${term}`);
      }
      for (const term of qualityCase.forbiddenTerms ?? []) {
        available++;
        if (!output.includes(term)) earned++;
        else failures.push(`${qualityCase.fixture}: forbidden ${term}`);
      }
      available++;
      const evidenceClaims = output.match(/\(evidence:/g)?.length ?? 0;
      if (evidenceClaims >= qualityCase.minimumEvidenceClaims) earned++;
      else failures.push(`${qualityCase.fixture}: only ${evidenceClaims} evidence claims`);
      available++;
      const consumerDocs = [
        files.get("CLAUDE.generated.md"),
        files.get("AGENTS.generated.md"),
        files.get(".github/copilot-instructions.generated.md"),
      ];
      if (consumerDocs.every(Boolean) && new Set(consumerDocs).size === 3) earned++;
      else failures.push(`${qualityCase.fixture}: consumer documents are not distinct`);
    }
    expect({ failures, earned, available, score: earned / available }).toMatchObject({ failures: [], score: 1 });
  });

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

  it("produces consumer-specific documents instead of title-only variants", async () => {
    const files = await renderCorpus("node-express-mocha", "en");
    const claude = files.get("CLAUDE.generated.md")!;
    const agents = files.get("AGENTS.generated.md")!;
    const copilot = files.get(".github/copilot-instructions.generated.md")!;
    expect(new Set([claude, agents, copilot])).toHaveLength(3);
    expect(claude).toContain("What CI runs");
    expect(agents).toContain("Operational rules");
    expect(copilot).not.toContain("What CI runs");
    expect(copilot).not.toContain("Repo commands");
  });

  it("renders observed facts and local conventions with evidence", async () => {
    const express = await renderCorpus("node-express-mocha", "en");
    const flask = await renderCorpus("python-uv-tox", "en");
    expect(express.get("CLAUDE.generated.md")).toContain("evidence: `.editorconfig`");
    expect(express.get("CLAUDE.generated.md")).toContain("Primary source code lives under lib/");
    expect(flask.get("CLAUDE.generated.md")).toContain("ruff configures a maximum line length of 100");
    expect(flask.get("CLAUDE.generated.md")).toContain("evidence: `pyproject.toml`");
  });
});
