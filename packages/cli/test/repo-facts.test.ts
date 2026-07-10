import { describe, it, expect } from "vitest";
import {
  extractNpmCommands,
  extractComposerCommands,
  extractMakeTargets,
  extractMixAliases,
  extractToxEnvs,
  filterCommands,
  extractStructure,
} from "../src/core/repo-facts.js";
import type { CommandEntry, RepoSignals } from "../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("extractNpmCommands", () => {
  it("maps scripts to npm run invocations with the script body as detail", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: { lint: "eslint .", test: "vitest run" },
          moduleType: "commonjs",
        },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm run lint", detail: "eslint ." });
  });

  it("uses the direct form for npm lifecycle scripts (test/start)", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { test: "vitest run" }, moduleType: "commonjs" },
      })
    );
    expect(entries).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest run" });
  });

  it("skips empty script bodies and returns [] without package.json", () => {
    expect(extractNpmCommands(baseSignals({}))).toEqual([]);
    const entries = extractNpmCommands(
      baseSignals({
        packageJson: { dependencies: {}, devDependencies: {}, scripts: { noop: "   " }, moduleType: "commonjs" },
      })
    );
    expect(entries).toEqual([]);
  });
});

describe("extractComposerCommands", () => {
  it("flattens string and array script values", () => {
    const entries = extractComposerCommands(
      baseSignals({
        composerJson: { require: {}, requireDev: {}, scripts: { test: "phpunit", check: ["phpcs", "phpstan"] } },
      })
    );
    expect(entries).toContainEqual({ source: "composer", invocation: "composer test", detail: "phpunit" });
    expect(entries).toContainEqual({ source: "composer", invocation: "composer check", detail: "phpcs && phpstan" });
  });

  it("skips non-string/non-array values and returns [] without composer.json", () => {
    expect(extractComposerCommands(baseSignals({}))).toEqual([]);
    const entries = extractComposerCommands(
      baseSignals({ composerJson: { require: {}, requireDev: {}, scripts: { weird: { nested: true } } } })
    );
    expect(entries).toEqual([]);
  });
});

describe("extractMakeTargets", () => {
  it("extracts top-level targets as make invocations", () => {
    const makefile = "build: deps\n\tgcc -o app main.c\n\ntest:\n\t./run-tests.sh\n";
    const entries = extractMakeTargets(baseSignals({ makefile }));
    expect(entries).toContainEqual({ source: "make", invocation: "make build" });
    expect(entries).toContainEqual({ source: "make", invocation: "make test" });
  });

  it("ignores special targets, pattern rules, variable assignments and recipe lines", () => {
    const makefile = [
      ".PHONY: build",
      "%.o: %.c",
      "CFLAGS := -Wall",
      "OUT ?= dist",
      "build:",
      "\tdocker build: not-a-target",
      "# https://example.com: comentario con dos puntos",
    ].join("\n");
    const entries = extractMakeTargets(baseSignals({ makefile }));
    expect(entries).toEqual([{ source: "make", invocation: "make build" }]);
  });

  it("returns [] without a Makefile and deduplicates repeated targets", () => {
    expect(extractMakeTargets(baseSignals({}))).toEqual([]);
    const entries = extractMakeTargets(baseSignals({ makefile: "all: a\nall: b\n" }));
    expect(entries).toEqual([{ source: "make", invocation: "make all" }]);
  });
});

describe("extractMixAliases", () => {
  it("extracts alias names from a Phoenix-style aliases function", () => {
    const mixExs = `
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      test: ["ecto.create --quiet", "test"]
    ]
  end
`;
    const entries = extractMixAliases(baseSignals({ mixExs }));
    expect(entries).toContainEqual({ source: "mix", invocation: "mix setup" });
    expect(entries).toContainEqual({ source: "mix", invocation: "mix ecto.setup" });
    expect(entries).toContainEqual({ source: "mix", invocation: "mix test" });
  });

  it("returns [] when there is no aliases function or no mix.exs", () => {
    expect(extractMixAliases(baseSignals({}))).toEqual([]);
    expect(extractMixAliases(baseSignals({ mixExs: "defp deps do\n  []\nend\n" }))).toEqual([]);
  });
});

describe("extractToxEnvs", () => {
  it("extracts envs from envlist as tox -e invocations", () => {
    const toxIni = "[tox]\nenvlist = py311, lint\n\n[testenv]\ncommands = pytest\n";
    const entries = extractToxEnvs(baseSignals({ toxIni }));
    expect(entries).toContainEqual({ source: "tox", invocation: "tox -e py311" });
    expect(entries).toContainEqual({ source: "tox", invocation: "tox -e lint" });
  });

  it("skips generator envs ({}) instead of guessing, and returns [] without tox.ini", () => {
    expect(extractToxEnvs(baseSignals({}))).toEqual([]);
    const entries = extractToxEnvs(baseSignals({ toxIni: "[tox]\nenvlist = py3{10,11}, docs\n" }));
    expect(entries).toEqual([{ source: "tox", invocation: "tox -e docs" }]);
  });
});

describe("filterCommands", () => {
  const mk = (n: number): CommandEntry[] =>
    Array.from({ length: n }, (_, i) => ({ source: "npm" as const, invocation: `npm run task${i}`, detail: "x" }));

  it("keeps everything under the per-source cap and reports nothing omitted", () => {
    const { kept, omitted } = filterCommands(mk(3));
    expect(kept).toHaveLength(3);
    expect(omitted).toEqual([]);
  });

  it("caps at 15 per source, always keeping well-known names, and reports the omitted count", () => {
    const entries = [...mk(20), { source: "npm" as const, invocation: "npm test", detail: "vitest" }];
    const { kept, omitted } = filterCommands(entries);
    expect(kept).toHaveLength(15);
    expect(kept).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest" });
    expect(omitted).toEqual([{ source: "npm", count: 6 }]);
  });

  it("applies the cap per source, not globally", () => {
    const make = Array.from({ length: 10 }, (_, i) => ({ source: "make" as const, invocation: `make t${i}` }));
    const { kept, omitted } = filterCommands([...mk(10), ...make]);
    expect(kept).toHaveLength(20);
    expect(omitted).toEqual([]);
  });
});

describe("extractStructure", () => {
  it("lists top-level dirs sorted, annotating only unequivocal names", () => {
    const files = ["src/index.ts", "src/deep/a.ts", "tests/a.test.ts", "weirddir/x.txt", "README.md"];
    const dirs = extractStructure(baseSignals({ files }));
    expect(dirs).toEqual([
      { dir: "src/", note: "código fuente" },
      { dir: "tests/", note: "tests" },
      { dir: "weirddir/" },
    ]);
  });

  it("caps at 20 dirs and returns [] for a flat repo", () => {
    expect(extractStructure(baseSignals({ files: ["README.md"] }))).toEqual([]);
    const files = Array.from({ length: 30 }, (_, i) => `dir${String(i).padStart(2, "0")}/f.txt`);
    expect(extractStructure(baseSignals({ files }))).toHaveLength(20);
  });
});
