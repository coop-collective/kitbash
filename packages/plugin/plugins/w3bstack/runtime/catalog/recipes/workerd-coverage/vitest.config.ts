import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: "./wrangler.jsonc" }, remoteBindings: false,
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") } },
  }))],
  test: {
    include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "istanbul",
      // Explicit include accounts for source files no test imports.
      include: ["src/**/*.ts"], exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json-summary", "lcov", "html"], reportsDirectory: "coverage",
      thresholds: { perFile: true, lines: 95, statements: 95, functions: 100, branches: 90 },
    },
  },
});
