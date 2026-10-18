// Tests run INSIDE workerd with the bindings from wrangler.jsonc, backed by local Miniflare storage: no Cloudflare
// account, no network. Node side (this file) prepares what workerd cannot read itself:
//   TEST_MIGRATIONS       ./migrations, applied by test/apply-migrations.ts before every test file
//   TOKEN_PEPPER          a random pepper for this run
//   REGISTRY_SIGNING_KEY  a fresh Ed25519 JWK for this run (nothing real is ever committed or reused)
//   TEST_FIXTURE_BLOCK    WP-01's email-code-auth fixture block ({manifest, files}) as JSON
//   PROD_SIM_DB           a second, empty D1 for test/migration-upgrade.test.ts
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../core/test/fixtures/blocks/email-code-auth-fixture");

function readBlock(dir: string): { manifest: unknown; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else if (r !== "block.json") files[r] = readFileSync(path.join(dir, r), "utf8");
    }
  };
  walk("");
  return { manifest: JSON.parse(readFileSync(path.join(dir, "block.json"), "utf8")), files };
}

const { privateKey } = generateKeyPairSync("ed25519");
const registryJwk = privateKey.export({ format: "jwk" });

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          TOKEN_PEPPER: randomBytes(32).toString("hex"),
          REGISTRY_SIGNING_KEY: JSON.stringify(registryJwk),
          TEST_FIXTURE_BLOCK: JSON.stringify(readBlock(FIXTURE)),
        },
        d1Databases: { PROD_SIM_DB: "prod-sim" },
        queueConsumers: {},
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
});
