import { describe, it, expect } from "vitest";
import { rustPack } from "../../src/packs/rust.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const CARGO_TOML_AXUM = `[package]
name = "app"
version = "0.1.0"

[dependencies]
axum = "0.7"
`;

describe("rustPack", () => {
  it("returns null with no Cargo.toml", () => {
    expect(rustPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Axum with high confidence", () => {
    const detection = rustPack.detect(baseSignals({ cargoToml: CARGO_TOML_AXUM }));
    expect(detection?.framework).toEqual({ value: "axum", confidence: "high" });
  });

  it("marks framework low confidence when no known framework is found", () => {
    const detection = rustPack.detect(
      baseSignals({ cargoToml: '[package]\nname = "app"\nversion = "0.1.0"\n' })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports cargo test and cargo with high confidence", () => {
    const detection = rustPack.detect(baseSignals({ cargoToml: '[package]\nname = "app"\n' }));
    expect(detection?.testRunner).toEqual({ value: "cargo test", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "cargo", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = rustPack.detect(baseSignals({ cargoToml: '[package]\nname = "app"\n' }))!;
    const templates = rustPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
