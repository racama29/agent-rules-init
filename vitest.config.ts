import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/cli/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/cli/src/**/*.ts"],
      exclude: ["packages/cli/src/bin.ts", "packages/cli/src/core/scanner-worker.ts"],
      thresholds: { lines: 90, functions: 82, statements: 90, branches: 85 },
    },
  },
});
