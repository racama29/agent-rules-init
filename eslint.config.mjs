import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "fixtures/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/cli/src/**/*.ts", "packages/cli/test/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/cli/scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", Buffer: "readonly" } },
  },
  {
    files: ["packages/cli/test/fixtures/**/*.cjs"],
    languageOptions: { globals: { process: "readonly" } },
  }
);
