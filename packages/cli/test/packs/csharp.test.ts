import { describe, it, expect } from "vitest";
import { csharpPack } from "../../src/packs/csharp.js";
import type { RepoSignals } from "../../src/core/types.js";

function baseSignals(overrides: Partial<RepoSignals>): RepoSignals {
  return { rootPath: "/fake", files: [], hasFile: () => false, hasDir: () => false, ...overrides };
}

const CSPROJ_ASPNET = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="xunit" Version="2.4.1" />
  </ItemGroup>
</Project>
`;

describe("csharpPack", () => {
  it("returns null with no .csproj", () => {
    expect(csharpPack.detect(baseSignals({}))).toBeNull();
  });

  it("detects ASP.NET Core + xUnit with high confidence", () => {
    const detection = csharpPack.detect(baseSignals({ csproj: CSPROJ_ASPNET }));
    expect(detection?.framework).toEqual({ value: "aspnet-core", confidence: "high" });
    expect(detection?.testRunner).toEqual({ value: "xunit", confidence: "high" });
  });

  it("marks framework low confidence when ASP.NET Core is not referenced", () => {
    const detection = csharpPack.detect(
      baseSignals({ csproj: '<Project Sdk="Microsoft.NET.Sdk"></Project>' })
    );
    expect(detection?.framework).toEqual({ value: "none", confidence: "low" });
  });

  it("always reports nuget as the package manager with high confidence", () => {
    const detection = csharpPack.detect(baseSignals({ csproj: '<Project Sdk="Microsoft.NET.Sdk"></Project>' }));
    expect(detection?.packageManager).toEqual({ value: "nuget", confidence: "high" });
  });

  it("produces review, refactor and testing prompt templates", () => {
    const detection = csharpPack.detect(
      baseSignals({ csproj: '<Project Sdk="Microsoft.NET.Sdk"></Project>' })
    )!;
    const templates = csharpPack.promptTemplates(detection, "es");
    expect(templates.map((t) => t.id).sort()).toEqual(["refactor", "review", "testing"]);
  });
});
