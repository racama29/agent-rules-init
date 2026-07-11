import { describe, it, expect } from "vitest";
import { canonicalOf, selectCanonicalCommands } from "../src/core/canonical-commands.js";
import type { CiCommand, CommandEntry, RepoSignals } from "../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals> = {}): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const none: CiCommand[] = [];

describe("selectCanonicalCommands", () => {
  it("picks test and lint from root manifest scripts", () => {
    const commands: CommandEntry[] = [
      { source: "npm", invocation: "npm test", detail: "mocha --recursive test/" },
      { source: "npm", invocation: "npm run lint", detail: "eslint lib/ test/" },
      { source: "npm", invocation: "npm run docs", detail: "jsdoc" },
    ];
    const result = selectCanonicalCommands(baseSignals(), commands, none);
    expect(result).toEqual([
      { kind: "test", command: "npm test", source: "package.json", confidence: "high", scope: "." },
      { kind: "lint", command: "npm run lint", source: "package.json", confidence: "high", scope: "." },
    ]);
  });

  it("ignores nested workspace manifests when picking root commands", () => {
    const commands: CommandEntry[] = [
      { source: "pnpm", invocation: "pnpm --dir apps/web run test", manifestPath: "apps/web/package.json" },
    ];
    expect(selectCanonicalCommands(baseSignals(), commands, none)).toEqual([]);
  });

  it("falls back to CI commands when no script matches", () => {
    const ci: CiCommand[] = [
      { command: "./mvnw -B verify", workflow: "build.yml" },
      { command: "./gradlew build", workflow: "build.yml" },
    ];
    const result = selectCanonicalCommands(baseSignals(), [], ci);
    expect(result).toEqual([
      { kind: "test", command: "./mvnw -B verify", source: "ci: build.yml", confidence: "high", scope: "." },
      { kind: "build", command: "./gradlew build", source: "ci: build.yml", confidence: "high", scope: "." },
    ]);
  });

  it("recognizes Windows Java wrapper commands from CI", () => {
    const ci: CiCommand[] = [
      { command: ".\\mvnw.cmd -B verify", workflow: "windows.yml" },
      { command: "gradlew.bat build", workflow: "windows.yml" },
    ];
    expect(selectCanonicalCommands(baseSignals(), [], ci)).toEqual([
      { kind: "test", command: ".\\mvnw.cmd -B verify", source: "ci: windows.yml", confidence: "high", scope: "." },
      { kind: "build", command: "gradlew.bat build", source: "ci: windows.yml", confidence: "high", scope: "." },
    ]);
  });

  it("prefers a manifest script over a CI command of the same kind", () => {
    const commands: CommandEntry[] = [{ source: "npm", invocation: "npm test", detail: "vitest run" }];
    const ci: CiCommand[] = [{ command: "npm test -- --coverage", workflow: "ci.yml" }];
    const result = selectCanonicalCommands(baseSignals(), commands, ci);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("npm test");
    expect(result[0].source).toBe("package.json");
  });

  it("recognizes uv-run pytest in CI", () => {
    const ci: CiCommand[] = [{ command: "uv run pytest", workflow: "tests.yml" }];
    expect(selectCanonicalCommands(baseSignals(), [], ci)).toEqual([
      { kind: "test", command: "uv run pytest", source: "ci: tests.yml", confidence: "high", scope: "." },
    ]);
  });

  it("recognizes uv options followed by tox run in CI", () => {
    const command = "uv run --locked --no-default-groups --group dev tox run";
    expect(selectCanonicalCommands(baseSignals(), [], [{ command, workflow: "tests.yml" }])).toEqual([
      { kind: "test", command, source: "ci: tests.yml", confidence: "high", scope: "." },
    ]);
  });
});

describe("selectCanonicalCommands language fallbacks", () => {
  it("uses the Maven wrapper when present", () => {
    const signals = baseSignals({ pomXml: "<project/>", hasFile: (p) => p === "mvnw" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "./mvnw test", source: "mvnw", confidence: "high", scope: "." },
    ]);
  });

  it("uses native commands when only Windows Java wrappers exist", () => {
    const maven = baseSignals({ pomXml: "<project/>", hasFile: (p) => p === "mvnw.cmd" });
    expect(selectCanonicalCommands(maven, [], none)[0]).toMatchObject({
      command: "mvnw.cmd test", source: "mvnw.cmd", confidence: "high",
    });

    const gradle = baseSignals({
      buildGradle: "plugins { id 'java' }",
      hasFile: (p) => p === "gradlew.bat",
    });
    expect(selectCanonicalCommands(gradle, [], none)[0]).toMatchObject({
      command: "gradlew.bat test", source: "gradlew.bat", confidence: "high",
    });
  });

  it("uses plain mvn only when no wrapper exists", () => {
    const signals = baseSignals({ pomXml: "<project/>" });
    expect(selectCanonicalCommands(signals, [], none)[0]).toMatchObject({
      command: "mvn test", source: "pom.xml", confidence: "low",
    });
  });

  it("keeps uv run pytest low-confidence when only the lock and a pytest mention are present", () => {
    const signals = baseSignals({
      pyprojectToml: '[project]\nname = "x"\n[project.optional-dependencies]\ndev = ["pytest"]\n',
      hasFile: (p) => p === "uv.lock",
    });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "uv run pytest", source: "uv.lock", confidence: "low", scope: "." },
    ]);
  });

  it("falls back to tox when only tox.ini decides", () => {
    const signals = baseSignals({ requirementsTxt: "flask\n", toxIni: "[tox]\nenv_list = py311\n" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." },
    ]);
  });

  it("CI beats a signal fallback", () => {
    const signals = baseSignals({ pomXml: "<project/>", hasFile: (p) => p === "mvnw" });
    const ci: CiCommand[] = [{ command: "./mvnw -B verify", workflow: "build.yml" }];
    const result = selectCanonicalCommands(signals, [], ci);
    expect(result[0].command).toBe("./mvnw -B verify");
  });

  it("uses the Gradle wrapper when present", () => {
    const signals = baseSignals({ buildGradle: "plugins { id 'java' }", hasFile: (p) => p === "gradlew" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "./gradlew test", source: "gradlew", confidence: "high", scope: "." },
    ]);
  });

  it("keeps poetry run pytest low-confidence without an explicit script or CI command", () => {
    const signals = baseSignals({
      pyprojectToml: '[project]\nname = "x"\n[project.optional-dependencies]\ndev = ["pytest"]\n',
      hasFile: (p) => p === "poetry.lock",
    });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "poetry run pytest", source: "poetry.lock", confidence: "low", scope: "." },
    ]);
  });

  it("prefers the explicit tox configuration over an inferred uv pytest command", () => {
    const signals = baseSignals({
      pyprojectToml: '[project.optional-dependencies]\ndev = ["pytest"]\n',
      toxIni: "[tox]\nenv_list = py311\n",
      hasFile: (p) => p === "uv.lock",
    });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "tox", source: "tox.ini", confidence: "high", scope: "." },
    ]);
  });

  it("isolates canonical commands by stack family in a mixed repository", () => {
    const signals = baseSignals({
      packageJson: {
        dependencies: {}, devDependencies: {}, scripts: { test: "vitest" }, moduleType: "module",
      },
      requirementsTxt: "pytest\n",
    });
    const commands: CommandEntry[] = [
      { source: "npm", invocation: "npm test", detail: "vitest" },
    ];
    const facts = {
      commands, omittedCommands: [], structure: [], ciCommands: [], omittedCiCount: 0,
      canonical: selectCanonicalCommands(signals, commands, []), testDirs: [], entrypoints: [],
    };
    expect(canonicalOf({ facts, signals }, "test", "js-ts")?.command).toBe("npm test");
    expect(canonicalOf({ facts, signals }, "test", "python")).toBeUndefined();
  });

  it("attributes the low-confidence pytest fallback to requirements.txt when that's the source", () => {
    const signals = baseSignals({ requirementsTxt: "pytest\nflask\n" });
    expect(selectCanonicalCommands(signals, [], none)).toEqual([
      { kind: "test", command: "pytest", source: "requirements.txt", confidence: "low", scope: "." },
    ]);
  });
});
