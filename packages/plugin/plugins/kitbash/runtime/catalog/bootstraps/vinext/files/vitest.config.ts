import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Module tests run in workerd with the source config's bindings. The production
// vinext entry uses virtual RSC modules, so a test entry imports only the health route.
// `pnpm smoke` separately verifies the built router and actual HTML over HTTP.
export default defineConfig({
  plugins: [cloudflareTest({ main: "./test/worker.ts", wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
});
