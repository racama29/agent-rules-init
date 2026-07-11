import { describe, expect, it } from "vitest";
import { applyProjectExcludes, buildPackageUnits, isProjectExcluded } from "../src/core/project-units.js";
import { renderProjectUnitAgents } from "../src/core/project-unit-output.js";
import type { RepoSignals } from "../src/core/types.js";

describe("buildPackageUnits", () => {
  it("creates package-relative signal views without sibling dependencies", () => {
    const files = [
      "package.json",
      "apps/web/package.json",
      "apps/web/tsconfig.json",
      "apps/web/src/index.ts",
      "apps/api/package.json",
      "apps/api/src/index.js",
    ];
    const signals: RepoSignals = {
      rootPath: "/repo",
      files,
      hasFile: (file) => files.includes(file.replace(/\\/g, "/")),
      hasDir: (dir) => files.some((file) => file.startsWith(`${dir.replace(/\\/g, "/")}/`)),
      packageJsons: [
        {
          path: "package.json", dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs",
        },
        {
          path: "apps/web/package.json", dependencies: { react: "^19" },
          devDependencies: { typescript: "^5" }, scripts: { test: "vitest" }, moduleType: "module",
        },
        {
          path: "apps/api/package.json", dependencies: { express: "^5" },
          devDependencies: {}, scripts: { test: "node --test" }, moduleType: "commonjs",
        },
      ],
      guidanceFiles: [{
        path: "apps/web/tsconfig.json", content: '{"compilerOptions":{"strict":true}}',
      }],
    };

    const units = buildPackageUnits(signals);
    expect(units.map((unit) => unit.path)).toEqual(["apps/web", "apps/api"]);

    const web = units[0].signals;
    expect(web.packageJson?.dependencies).toEqual({ react: "^19" });
    expect(web.packageJson?.dependencies.express).toBeUndefined();
    expect(web.files).toEqual(["package.json", "tsconfig.json", "src/index.ts"]);
    expect(web.hasFile("tsconfig.json")).toBe(true);
    expect(web.hasDir("src")).toBe(true);
    expect(web.packageJsons?.[0].path).toBe("package.json");
    expect(web.guidanceFiles).toEqual([{
      path: "tsconfig.json", content: '{"compilerOptions":{"strict":true}}',
    }]);
  });

  it("renders package-scoped rules and commands", () => {
    const files = ["package.json", "apps/web/package.json", "apps/web/src/index.ts"];
    const signals: RepoSignals = {
      rootPath: "/repo", files,
      hasFile: (file) => files.includes(file.replace(/\\/g, "/")),
      hasDir: (dir) => files.some((file) => file.startsWith(`${dir.replace(/\\/g, "/")}/`)),
      packageJsons: [{
        path: "apps/web/package.json", dependencies: { react: "^19" },
        devDependencies: { vitest: "^3" }, scripts: { test: "vitest run" }, moduleType: "module",
      }],
    };
    const unit = buildPackageUnits(signals)[0];
    const output = renderProjectUnitAgents(unit, "en");
    expect(output?.path).toBe("apps/web/AGENTS.generated.md");
    expect(output?.content).toContain("using react");
    expect(output?.content).toContain("- test: `npm test` (package.json)");
    expect(output?.content).not.toContain("npm --prefix");
  });

  it("excludes configured projects before dependency aggregation", () => {
    expect(isProjectExcluded("legacy/web", ["legacy/**"])).toBe(true);
    expect(isProjectExcluded("apps/web", ["legacy/**", "apps/admin"])).toBe(false);

    const files = ["package.json", "apps/web/package.json", "legacy/api/package.json"];
    const signals: RepoSignals = {
      rootPath: "/repo", files,
      hasFile: (file) => files.includes(file), hasDir: () => false,
      packageJsons: [
        { path: "package.json", dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
        { path: "apps/web/package.json", dependencies: { react: "^19" }, devDependencies: {}, scripts: {}, moduleType: "module" },
        { path: "legacy/api/package.json", dependencies: { express: "^5" }, devDependencies: {}, scripts: {}, moduleType: "commonjs" },
      ],
    };
    const filtered = applyProjectExcludes(signals, ["legacy/**"]);
    expect(filtered.packageJson?.dependencies.react).toBe("^19");
    expect(filtered.packageJson?.dependencies.express).toBeUndefined();
    expect(filtered.files).not.toContain("legacy/api/package.json");
  });

  it("preserves the root manifest's main entrypoint when reconstructing the aggregated packageJson", () => {
    const files = ["package.json", "apps/web/package.json", "legacy/api/package.json"];
    const signals: RepoSignals = {
      rootPath: "/repo", files,
      hasFile: (file) => files.includes(file), hasDir: () => false,
      packageJsons: [
        {
          path: "package.json", main: "dist/index.js",
          dependencies: {}, devDependencies: {}, scripts: {}, moduleType: "commonjs",
        },
        {
          path: "apps/web/package.json", dependencies: { react: "^19" },
          devDependencies: {}, scripts: {}, moduleType: "module",
        },
        {
          path: "legacy/api/package.json", dependencies: { express: "^5" },
          devDependencies: {}, scripts: {}, moduleType: "commonjs",
        },
      ],
    };
    const filtered = applyProjectExcludes(signals, ["legacy/**"]);
    expect(filtered.packageJson?.main).toBe("dist/index.js");
  });

  it("passes unit-scoped facts as ctx so nested rules cite the canonical script invocation", () => {
    const files = ["package.json", "apps/web/package.json", "apps/web/src/index.ts"];
    const signals: RepoSignals = {
      rootPath: "/repo", files,
      hasFile: (file) => files.includes(file.replace(/\\/g, "/")),
      hasDir: (dir) => files.some((file) => file.startsWith(`${dir.replace(/\\/g, "/")}/`)),
      packageJsons: [{
        path: "apps/web/package.json", dependencies: {},
        devDependencies: { vitest: "^3" }, scripts: { test: "vitest run" }, moduleType: "module",
      }],
    };
    const unit = buildPackageUnits(signals)[0];
    const output = renderProjectUnitAgents(unit, "en");
    expect(output?.content).toContain("Run the tests with npm test before finishing a task.");
    expect(output?.content).not.toContain("Run the tests with vitest before finishing a task.");
  });
});
