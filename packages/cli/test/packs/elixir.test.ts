import { describe, it, expect } from "vitest";
import { elixirPack } from "../../src/packs/elixir.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const MIX_EXS_PHOENIX = `defmodule MyApp.MixProject do
  use Mix.Project

  defp deps do
    [
      {:phoenix, "~> 1.7.0"},
      {:phoenix_live_view, "~> 0.20.0"}
    ]
  end
end
`;

describe("elixirPack", () => {
  it("returns null with no mix.exs", () => {
    expect(elixirPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects Phoenix with high confidence", () => {
    const detection = elixirPack.detect(baseSignals({ mixExs: MIX_EXS_PHOENIX }));
    expect(detection?.framework).toEqual({ value: "phoenix", confidence: "high" });
  });

  it("does not mistake sibling packages (phoenix_pubsub) or the project's own app name for a real phoenix dependency (e.g. Phoenix's own mix.exs)", () => {
    const phoenixOwnMixExs = `defmodule Phoenix.MixProject do\n  use Mix.Project\n\n  def project do\n    [\n      app: :phoenix,\n      name: "Phoenix"\n    ]\n  end\n\n  defp deps do\n    [\n      {:phoenix_pubsub, "~> 2.1"},\n      {:phoenix_template, "~> 1.0"}\n    ]\n  end\nend\n`;
    const detection = elixirPack.detect(baseSignals({ mixExs: phoenixOwnMixExs }));
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("marks framework low confidence when Phoenix is not referenced", () => {
    const detection = elixirPack.detect(
      baseSignals({ mixExs: "defmodule MyApp.MixProject do\n  use Mix.Project\nend\n" })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports mix test and mix with high confidence", () => {
    const detection = elixirPack.detect(baseSignals({ mixExs: "defmodule MyApp.MixProject do\nend\n" }));
    expect(detection?.testRunner).toEqual({ value: "mix test", confidence: "high" });
    expect(detection?.packageManager).toEqual({ value: "mix", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = elixirPack.detect(baseSignals({ mixExs: "defmodule MyApp.MixProject do\nend\n" }))!;
    const templates = elixirPack.promptTemplates(detection);
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
