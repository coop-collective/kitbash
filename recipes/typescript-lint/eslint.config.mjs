import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/.wrangler/**", "**/dist/**", "**/.next/**", "**/coverage/**", "**/.cache/**", "**/worker-configuration.d.ts", "**/next-env.d.ts"]),
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  { files: ["**/*.{js,mjs,cjs}"], extends: [js.configs.recommended], languageOptions: { globals: globals.node } },
]);
