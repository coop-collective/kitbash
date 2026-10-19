import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const json = (value) => JSON.stringify(value, null, 2) + "\n";
export async function writeStarter(directory) {
  const files = {
    "package.json": json({
      name: "kitchen-sink",
      private: true,
      type: "module",
      packageManager: "pnpm@12.14.0",
      scripts: {
        dev: "wrangler dev",
        build: "wrangler deploy --dry-run --outdir dist",
        typecheck: "wrangler types --strict-vars=false && tsc --noEmit",
        test: "vitest run",
        "db:local": "wrangler d1 migrations apply DB --local",
      },
      dependencies: { hono: "4.13.9" },
      devDependencies: {
        "@cloudflare/vitest-pool-workers": "0.22.0",
        "@types/node": "24.13.2",
        typescript: "5.9.3",
        vitest: "4.1.11",
        wrangler: "4.151.1",
      },
    }),
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: true\n  workerd: true\n",
    "wrangler.jsonc": json({
      name: "kitchen-sink-local",
      main: "src/index.ts",
      compatibility_date: "2026-08-22",
      compatibility_flags: ["nodejs_compat"],
      vars: { ENVIRONMENT: "dev" },
      assets: {
        directory: "public",
        binding: "ASSETS",
        run_worker_first: ["/api/*"],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "local-kitchen-sink",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "migrations",
        },
      ],
      r2_buckets: [
        { binding: "UPLOADS", bucket_name: "local-private-uploads" },
      ],
      kv_namespaces: [
        { binding: "RESULT_CACHE", id: "00000000000000000000000000000000" },
      ],
    }),
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022"],
        types: ["@cloudflare/vitest-pool-workers/types", "node"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        resolveJsonModule: true,
      },
      include: ["src", "test", "vitest.config.ts", "worker-configuration.d.ts"],
    }),
    "vitest.config.ts": `import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';\nimport { defineConfig } from 'vitest/config';\nexport default defineConfig({plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.jsonc'},miniflare:{bindings:{TEST_MIGRATIONS:await readD1Migrations('./migrations')}}}))],test:{include:['test/**/*.test.ts'],setupFiles:['./test/apply-migrations.ts']}});\n`,
    "test/apply-migrations.ts": `import { applyD1Migrations, type D1Migration } from 'cloudflare:test';\nimport { env } from 'cloudflare:workers';\nawait applyD1Migrations(env.DB, (env as unknown as {TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS);\n`,
    "test/health.test.ts": `import { expect, it } from 'vitest';\nimport { SELF } from 'cloudflare:test';\nit('health', async()=>{expect((await SELF.fetch('http://localhost/api/health')).status).toBe(200)});\n`,
    "src/index.ts": `import { Hono } from 'hono';\nconst app = new Hono<{Bindings:Env}>();\napp.get('/api/health', c=>c.json({ok:true}));\napp.all('*', c=>c.env.ASSETS.fetch(c.req.raw));\nexport default app;\n`,
    "public/index.html":
      "<!doctype html><html><head><title>Kitchen Sink</title></head><body><h1>Kitchen Sink</h1><p>Build the app here.</p></body></html>\n",
    "migrations/0000_initial.sql":
      "CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);\n",
    ".dev.vars":
      "SESSION_SECRET=local-only-session-secret-at-least-32-characters\nDEMO_PASSWORD=local-demo-password\n",
    ".gitignore":
      "node_modules/\n.wrangler/\ndist/\nworker-configuration.d.ts\n.dev.vars\n.catalog-cache/\n.kit-home/\n",
  };
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(directory, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}
