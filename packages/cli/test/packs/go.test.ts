import { describe, it, expect } from "vitest";
import { goPack } from "../../src/packs/go.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const GO_MOD_GIN = `module example.com/app

go 1.21

require github.com/gin-gonic/gin v1.9.1
`;

describe("goPack", () => {
  it("returns null with no go.mod", () => {
    expect(goPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Gin with high confidence", () => {
    const detection = goPack.detect(baseSignals({ goMod: GO_MOD_GIN }));
    expect(detection?.framework).toEqual({ value: "gin", confidence: "high" });
  });

  it("does not mistake the project's own module path for a framework dependency (e.g. gofiber/fiber's own go.mod)", () => {
    const fiberOwnGoMod = `module github.com/gofiber/fiber/v3\n\ngo 1.25.0\n\nrequire (\n\tgithub.com/google/uuid v1.6.0\n\tgithub.com/stretchr/testify v1.11.1\n)\n`;
    const detection = goPack.detect(baseSignals({ goMod: fiberOwnGoMod }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = goPack.detect(baseSignals({ goMod: "module example.com/app\n\ngo 1.21\n" }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports go test and go modules with high confidence", () => {
    const detection = goPack.detect(baseSignals({ goMod: "module example.com/app\n" }));
    expect(detection?.testRunner).toEqual({ value: "go test", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "go modules", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = goPack.detect(baseSignals({ goMod: "module example.com/app\n" }))!;
    const templates = goPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
