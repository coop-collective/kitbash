// Tests run INSIDE workerd with the bindings from wrangler.jsonc, backed by local Miniflare storage: no Cloudflare
// account, no network. ./migrations are read here (Node side) into TEST_MIGRATIONS and applied to the test D1 by
// test/apply-migrations.ts (a setupFile) before every test file.
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
{{#kit.if prodSim}}
      // PROD_SIM_DB: a second, empty D1 for test/migration-upgrade.test.ts, which replays the migrations production
      // already ran, with rows in it, and then applies the newer migrations on top.
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") }, d1Databases: { PROD_SIM_DB: "prod-sim" } },
{{kit.else}}
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") } },
{{/kit.if}}
    })),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
});
