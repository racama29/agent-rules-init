import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      // Entry points are exercised by the packed-artifact smoke test in separate processes.
      exclude: ["src/bin.ts", "src/core/scanner-worker.ts"],
      thresholds: { lines: 90, functions: 82, statements: 90, branches: 85 },
    },
  },
});
