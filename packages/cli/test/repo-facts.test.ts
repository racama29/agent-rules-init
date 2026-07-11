import { describe, it, expect } from "vitest";
import {
  extractNpmCommands,
  extractJsPackageCommands,
  extractComposerCommands,
  extractMakeTargets,
  extractMixAliases,
  extractToxEnvs,
  filterCommands,
  extractStructure,
  extractCiCommands,
  buildRepoFacts,
  detectTestDirs,
  detectEntrypoints,
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

  it("emits executable --prefix commands and origins for nested npm packages", () => {
    const entries = extractNpmCommands(
      baseSignals({
        packageJsons: [
          {
            path: "packages/web/package.json",
            dependencies: {}, devDependencies: {}, moduleType: "module",
            scripts: { test: "vitest run", build: "vite build" },
          },
        ],
      })
    );
    expect(entries).toContainEqual({
      source: "npm",
      invocation: "npm --prefix packages/web test",
      detail: "vitest run",
      manifestPath: "packages/web/package.json",
    });
    expect(entries).toContainEqual({
      source: "npm",
      invocation: "npm --prefix packages/web run build",
      detail: "vite build",
      manifestPath: "packages/web/package.json",
    });
  });

  it.each([
    ["pnpm", "pnpm --dir packages/web test", "pnpm --dir packages/web run build"],
    ["yarn", "yarn --cwd packages/web run test", "yarn --cwd packages/web run build"],
    ["bun", "bun --cwd packages/web run test", "bun --cwd packages/web run build"],
  ] as const)("uses executable %s invocations for nested packages", (packageManager, testCommand, buildCommand) => {
    const entries = extractJsPackageCommands(
      baseSignals({
        packageJsons: [{
          path: "packages/web/package.json",
          packageManager,
          dependencies: {}, devDependencies: {}, moduleType: "module",
          scripts: { test: "vitest run", build: "vite build" },
        }],
      })
    );
    expect(entries.map(({ source, invocation }) => ({ source, invocation }))).toEqual([
      { source: packageManager, invocation: testCommand },
      { source: packageManager, invocation: buildCommand },
    ]);
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

describe("extractCiCommands", () => {
  const wf = (content: string, p = ".github/workflows/ci.yml") =>
    baseSignals({ githubWorkflows: [{ path: p, content }] });

  it("collects run steps line by line, including block scalars", () => {
    const { commands } = extractCiCommands(
      wf(
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: |\n          npm run lint\n          npm test\n"
      )
    );
    expect(commands).toEqual([
      { command: "npm ci", workflow: "ci.yml" },
      { command: "npm run lint", workflow: "ci.yml" },
      { command: "npm test", workflow: "ci.yml" },
    ]);
  });

  it("deduplicates across workflows keeping the first origin, and skips comments/empty lines", () => {
    const signals = baseSignals({
      githubWorkflows: [
        {
          path: ".github/workflows/a.yml",
          content: "jobs:\n  j:\n    steps:\n      - run: |\n          # comentario\n\n          npm test\n",
        },
        { path: ".github/workflows/b.yml", content: "jobs:\n  j:\n    steps:\n      - run: npm test\n" },
      ],
    });
    const { commands } = extractCiCommands(signals);
    expect(commands).toEqual([{ command: "npm test", workflow: "a.yml" }]);
  });

  it("ignores unparseable workflows and workflows without jobs, and returns [] without workflows", () => {
    expect(extractCiCommands(baseSignals({})).commands).toEqual([]);
    expect(extractCiCommands(wf(":: not yaml ::")).commands).toEqual([]);
    expect(extractCiCommands(wf("name: empty\non: push\n")).commands).toEqual([]);
  });

  it("skips pure shell control-flow lines from multi-line run blocks", () => {
    const { commands } = extractCiCommands(
      wf(
        "jobs:\n  j:\n    steps:\n      - run: |\n          if [[ $TAG == v1.* ]]; then\n            echo old\n          else\n            echo new\n          fi\n          npm publish\n"
      )
    );
    expect(commands.map((c) => c.command)).toEqual(["echo old", "echo new", "npm publish"]);
  });

  it("caps at 30 commands and reports the omitted count", () => {
    const runs = Array.from({ length: 35 }, (_, i) => `      - run: echo ${i}`).join("\n");
    const { commands, omittedCount } = extractCiCommands(wf(`jobs:\n  j:\n    steps:\n${runs}\n`));
    expect(commands).toHaveLength(30);
    expect(omittedCount).toBe(5);
  });
});

describe("extractStructure", () => {
  it("lists top-level dirs sorted, annotating only unequivocal names", () => {
    const files = ["src/index.ts", "src/deep/a.ts", "tests/a.test.ts", "weirddir/x.txt", "README.md"];
    const dirs = extractStructure(baseSignals({ files }), "es");
    expect(dirs).toEqual([
      { dir: "src/", note: "código fuente" },
      { dir: "tests/", note: "tests" },
      { dir: "weirddir/" },
    ]);
  });

  it("annotates structure in English when lang is en", () => {
    const dirs = extractStructure(baseSignals({ files: ["src/index.ts"] }), "en");
    expect(dirs).toEqual([{ dir: "src/", note: "source code" }]);
  });

  it("caps at 20 dirs and returns [] for a flat repo", () => {
    expect(extractStructure(baseSignals({ files: ["README.md"] }), "es")).toEqual([]);
    const files = Array.from({ length: 30 }, (_, i) => `dir${String(i).padStart(2, "0")}/f.txt`);
    expect(extractStructure(baseSignals({ files }), "es")).toHaveLength(20);
  });
});

describe("detectTestDirs", () => {
  it("finds top-level test dirs and their first-level children", () => {
    expect(detectTestDirs([
      "lib/app.js",
      "test/app.test.js",
      "test/acceptance/routes.test.js",
    ])).toEqual(["test/", "test/acceptance/"]);
  });

  it("finds the Maven test layout", () => {
    expect(detectTestDirs([
      "src/main/java/demo/App.java",
      "src/test/java/demo/AppTest.java",
    ])).toEqual(["src/test/", "src/test/java/"]);
  });

  it("returns nothing when no test dir exists", () => {
    expect(detectTestDirs(["lib/app.js", "README.md"])).toEqual([]);
  });
});

describe("detectEntrypoints", () => {
  it("reads package.json main", () => {
    const signals = baseSignals({
      packageJson: {
        main: "lib/app.js", dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs",
      },
    });
    expect(detectEntrypoints(signals)).toEqual([
      { label: "main", target: "lib/app.js", source: "package.json" },
    ]);
  });

  it("reads pyproject [project.scripts]", () => {
    const signals = baseSignals({
      pyprojectToml: '[project]\nname = "x"\n\n[project.scripts]\nfixture-app = "fixture_app.cli:main"\n',
    });
    expect(detectEntrypoints(signals)).toEqual([
      { label: "fixture-app", target: "fixture_app.cli:main", source: "pyproject.toml" },
    ]);
  });
});

describe("buildRepoFacts", () => {
  it("assembles commands from every source plus structure and CI", () => {
    const facts = buildRepoFacts(
      baseSignals({
        files: ["src/index.ts", "package.json"],
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: { test: "vitest run" },
          moduleType: "module",
        },
        makefile: "docs:\n\tsphinx-build\n",
        githubWorkflows: [
          { path: ".github/workflows/ci.yml", content: "jobs:\n  j:\n    steps:\n      - run: npm ci\n" },
        ],
      }),
      "es"
    );
    expect(facts.commands).toContainEqual({ source: "npm", invocation: "npm test", detail: "vitest run" });
    expect(facts.commands).toContainEqual({ source: "make", invocation: "make docs" });
    expect(facts.structure).toEqual([{ dir: "src/", note: "código fuente" }]);
    expect(facts.ciCommands).toEqual([{ command: "npm ci", workflow: "ci.yml" }]);
    expect(facts.omittedCommands).toEqual([]);
    expect(facts.omittedCiCount).toBe(0);
  });

  it("returns fully empty facts for an empty repo", () => {
    const facts = buildRepoFacts(baseSignals({}), "es");
    expect(facts).toEqual({
      commands: [], omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0, canonical: [],
      testDirs: [], entrypoints: [],
    });
  });

  it("fills canonical commands from the extracted scripts", () => {
    const signals = baseSignals({
      packageJson: {
        dependencies: {}, devDependencies: {}, moduleType: "commonjs",
        scripts: { test: "mocha", lint: "eslint ." },
      },
    });
    const facts = buildRepoFacts(signals, "en");
    expect(facts.canonical).toEqual([
      { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
      { kind: "lint", command: "npm run lint", source: "package.json", confidence: "high", scope: "." },
    ]);
  });
});
