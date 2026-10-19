// Tests run INSIDE workerd with the bindings from wrangler.jsonc, backed by local Miniflare storage: no Cloudflare
// account, no network. ./migrations are read here (Node side) into TEST_MIGRATIONS and applied to the test D1 by
// test/apply-migrations.ts (a setupFile) before every test file.
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") } },
    })),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
});
