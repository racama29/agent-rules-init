import { describe, it, expect } from "vitest";
import { rubyPack } from "../../src/packs/ruby.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

describe("rubyPack", () => {
  it("returns null with no Gemfile", () => {
    expect(rubyPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Rails + RSpec with high confidence", () => {
    const detection = rubyPack.detect(
      baseSignals({ gemfile: "gem 'rails'\ngroup :test do\n  gem 'rspec-rails'\nend" })
    );
    expect(detection?.framework).toEqual({ value: "rails", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "rspec", confidence: "high" });
  });

  it("detects Sinatra", () => {
    const detection = rubyPack.detect(baseSignals({ gemfile: "gem 'sinatra'" }));
    expect(detection?.framework).toEqual({ value: "sinatra", confidence: "high" });
  });

  it("marks framework low confidence when no known framework gem is found", () => {
    const detection = rubyPack.detect(baseSignals({ gemfile: "gem 'rake'" }));
    expect(detection?.framework?.confidence).toBe("low");
  });

  it("always reports bundler as the package manager with high confidence", () => {
    const detection = rubyPack.detect(baseSignals({ gemfile: "gem 'rake'" }));
    expect(detection?.packageManager).toEqual({ value: "bundler", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = rubyPack.detect(baseSignals({ gemfile: "gem 'rake'" }))!;
    const templates = rubyPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
