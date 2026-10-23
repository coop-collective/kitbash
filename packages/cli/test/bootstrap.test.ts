import { readFile, writeFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { kit, tmpDir, readJson, snapshot, repo } from "./helpers.ts";
import { run } from "../src/cli.ts";
import type { Io } from "../src/io.ts";

const common = ["--yes", "--no-git", "--json"];

describe("project bootstrap", () => {
  it("lists supported presets and compatible block variants without writing", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "--list", "--preset", "worker", "--json"], { cwd });
    expect(result.code, result.out).toBe(0);
    const data = JSON.parse(result.out);
    expect(data.presets.map((p: {id:string}) => p.id)).toEqual(["worker", "vinext", "rust-server"]);
    expect(data.blocks.find((b: {name:string}) => b.name === "cloudflare-container").variants).toEqual(["bun", "go", "rust"]);
    expect(await readdir(cwd)).toEqual([]);
  });

  it("assembles a Worker, transitive blocks, migration sequence, and portable source snapshots", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--blocks", "email-code-auth,cli-oauth-login", ...common], { cwd });
    expect(result.code, result.out + result.err).toBe(0);
    const root = path.join(cwd, "my-api");
    const profile = await readJson(path.join(root, ".kit/project.json"));
    expect(profile.paths.lib).toBe("src/lib");
    const lock = await readJson(path.join(root, ".kit/lock.json"));
    expect(Object.keys(lock.blocks)).toEqual(expect.arrayContaining(["@local/crypto-utils", "@local/cf-email-sender", "@local/email-code-auth", "@local/cli-oauth-login"]));
    const sources = await readJson(path.join(root, ".kit/sources.json"));
    expect(sources["@local/crypto-utils"].path).toBe(".kit/catalog/blocks/crypto-utils");
    const diff = await kit(["diff", "@local/crypto-utils", "--json"], { cwd: root });
    expect(diff.code, diff.out).toBe(0);
    expect(JSON.parse(result.out).pending_adapt.length).toBeGreaterThan(0);
    const secrets = await readJson(path.join(root, ".kitbash/secrets.json"));
    expect(secrets.secrets.TOKEN_PEPPER.rotation).toBe("migration-required");
    const files = await snapshot(root);
    expect(Object.keys(files).some(p => p.endsWith(".dev.vars"))).toBe(false);
    expect(files["package.json"]).toContain("secrets:local");
  });

  it("records custom deployment domain in production and pins vinext's flattened target", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-web", "--preset", "vinext", "--blocks", "crypto-utils,public-edge-cache", "--hostname", "web.example.com", "--infisical-project", "12345678-1234-1234-1234-123456789abc", ...common], { cwd });
    expect(result.code, result.out).toBe(0);
    const root = path.join(cwd, "my-web");
    const config = await readJson(path.join(root, "wrangler.jsonc"));
    expect(config.env.production.routes).toEqual([{ pattern: "web.example.com", custom_domain: true }]);
    expect(config.env.staging.routes).toBeUndefined();
    const secrets = await readJson(path.join(root, ".kitbash/secrets.json"));
    expect(secrets.projectId).toBe("12345678-1234-1234-1234-123456789abc");
    expect(secrets.targets.production.workerName).toBe("my-web-production");
    expect(secrets.targets.production.wranglerConfig).toBe("dist/server/wrangler.json");
  });

  it("accepts selecting both a consumer and its dependency, in either order", async () => {
    const cwd = await tmpDir();
    for (const [directory, blocks] of [["consumer-first", "email-code-auth,cf-email-sender"], ["dependency-first", "cf-email-sender,email-code-auth"]]) {
      const result = await kit(["bootstrap", directory!, "--preset", "worker", "--blocks", blocks!, "--param", "cf-email-sender.appDomain=example.test", ...common], { cwd });
      expect(result.code, result.out).toBe(0);
      const lock = await readJson(path.join(cwd, directory!, ".kit/lock.json"));
      expect(lock.blocks["@local/cf-email-sender"].params.appDomain).toBe("example.test");
      expect(Object.keys(lock.blocks).filter(id => id.endsWith("/cf-email-sender"))).toHaveLength(1);
    }
  });

  it("copies explicit environment bindings and exports the installed Durable Object", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--blocks", "hibernating-websocket,r2-private-uploads,tiered-result-cache", ...common], { cwd });
    expect(result.code, result.out).toBe(0);
    const root = path.join(cwd, "my-api");
    const config = await readJson(path.join(root, "wrangler.jsonc"));
    expect(config.env.staging.r2_buckets[0].bucket_name).toBe("my-api-staging-uploads");
    expect(config.env.production.r2_buckets[0].bucket_name).toBe("my-api-production-uploads");
    expect(config.env.production.kv_namespaces[0]).toEqual({ binding: "RESULT_CACHE", id: "REPLACE_ME" });
    const symbol = config.durable_objects.bindings[0].class_name;
    expect(await readFile(path.join(root, "src/index.ts"), "utf8")).toContain(`export { ${symbol} }`);
  });

  it("creates a local Rust service with explicit host/port and no TS blocks", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-server", "--preset", "rust-server", "--host", "127.0.0.1", "--port", "9191", ...common], { cwd });
    expect(result.code, result.out).toBe(0);
    const root = path.join(cwd, "my-server");
    expect(await readFile(path.join(root, "src/main.rs"), "utf8")).toContain("9191");
    expect((await readJson(path.join(root, "package.json"))).scripts.build).toContain("cargo build");
    expect((await readJson(path.join(root, ".kitbash/secrets.json"))).targets.local.localFile).toBe(".env.local");
    expect(JSON.parse(result.out).blocks).toEqual([]);
  });

  it("rejects incompatibility before writing, and preserves a nonempty or symlink target", async () => {
    const cwd = await tmpDir();
    let result = await kit(["bootstrap", "bad", "--preset", "rust-server", "--blocks", "jwt-session-cookie", ...common], { cwd });
    expect(result.code).toBe(1);
    expect(await readdir(cwd)).toEqual([]);
    await writeFile(path.join(cwd, "keep"), "owned");
    result = await kit(["bootstrap", ".", "--preset", "worker", ...common], { cwd });
    expect(result.code).toBe(1);
    expect(await readFile(path.join(cwd, "keep"), "utf8")).toBe("owned");
    const other = await tmpDir();
    await symlink(other, path.join(cwd, "linked"));
    result = await kit(["bootstrap", "linked", "--preset", "worker", ...common], { cwd });
    expect(result.code).toBe(1);
    expect(await readdir(other)).toEqual([]);
  });

  it("removes staging files after a block parameter/variant error", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--blocks", "crypto-utils:no-such-variant", ...common], { cwd });
    expect(result.code).toBe(1);
    expect(await readdir(cwd)).toEqual([]);
  });

  it("only configures a remote unless create-repo is explicit; never commits or pushes", async () => {
    const cwd = await tmpDir();
    const commands: string[][] = [];
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--git-host", "github", "--repo", "coop/my-api", "--yes", "--json"], {
      cwd, runner: async (file, args) => { commands.push([file, ...args]); return { exit: 0, output: "" }; },
    });
    expect(result.code, result.out).toBe(0);
    expect(commands).toEqual([["git", "init", "--initial-branch=main"], ["git", "remote", "add", "origin", "https://github.com/coop/my-api.git"]]);
    expect(JSON.parse(result.out).git.created).toBe(false);
    const deployment = await readFile(path.join(cwd, "my-api/.github/workflows/deploy.yml"), "utf8");
    expect(deployment).toContain("method: oidc");
    expect(deployment).toContain("pnpm run deploy");
  });

  it("generates Gitstalk checks and staging deployment with its supported authentication", async () => {
    const cwd = await tmpDir();
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--git-host", "gitstalk", "--repo", "coop/my-api", "--yes", "--json"], {
      cwd, runner: async () => ({ exit: 0, output: "" }),
    });
    expect(result.code, result.out).toBe(0);
    const checks = await readFile(path.join(cwd, "my-api/.github/workflows/check.yml"), "utf8");
    expect(checks).toContain("branches: [main]");
    expect(checks).not.toContain("pull_request:");
    const deployment = await readFile(path.join(cwd, "my-api/.gitstalk/automations/deploy-staging.yml"), "utf8");
    expect(deployment).toContain("INFISICAL_CLIENT_ID");
    expect(deployment).toContain("pnpm run deploy --env staging");
  });

  it("GitHub creation uses argv and only forge credentials; output cannot expose child secrets", async () => {
    const cwd = await tmpDir();
    let sawCreate = false;
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--git-host", "github", "--repo", "coop/my-api", "--create-repo", "--yes", "--json"], {
      cwd, env: { GH_TOKEN: "forge-value", INFISICAL_TOKEN: "vault-value" },
      runner: async (file, args, opts) => {
        if (file === "gh") { sawCreate = true; expect(args).toContain("--private"); expect(opts.env.GH_TOKEN).toBe("forge-value"); }
        expect(opts.env.INFISICAL_TOKEN).toBeUndefined();
        return { exit: 0, output: "forge-value vault-value" };
      },
    });
    expect(result.code, result.out).toBe(0);
    expect(sawCreate).toBe(true);
    expect(result.out + result.err).not.toMatch(/forge-value|vault-value/);
  });

  it("regenerates the dependency lock after adding blocks even when the harness sets CI", async () => {
    const cwd = await tmpDir();
    const commands: string[][] = [];
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--blocks", "jwt-session-cookie", "--install", ...common], {
      cwd, env: { CI: "1" }, runner: async (file, args) => {
        commands.push([file, ...args]);
        expect((await readJson(path.join(cwd, "my-api/package.json"))).dependencies.jose).toBeDefined();
        return { exit: 0, output: "" };
      },
    });
    expect(result.code, result.out).toBe(0);
    expect(commands).toEqual([["pnpm", "install", "--no-frozen-lockfile"]]);
  });

  it("creates Gitstalk repo with explicit scope and rejects an existing name without adopting it", async () => {
    const cwd = await tmpDir();
    const commands: string[][] = [];
    const result = await kit(["bootstrap", "my-api", "--preset", "worker", "--git-host", "gitstalk", "--repo", "coop/my-api", "--create-repo", "--yes", "--json"], {
      cwd, env: { GITSTALK_TOKEN: "forge-value" },
      runner: async (file, args) => { commands.push([file, ...args]); return { exit: 0, output: "" }; },
      fetch: (async (url, options) => {
        expect(url).toBe("https://gitstalk.io/api/repos");
        expect(options?.redirect).toBe("error");
        expect(JSON.parse(options?.body as string)).toEqual({ owner: "coop", name: "my-api", visibility: "private", start: "empty" });
        return new Response("already exists", { status: 409 });
      }) as typeof fetch,
    });
    expect(result.code).toBe(1);
    expect(commands).toEqual([["git", "init", "--initial-branch=main"]]);
    expect(result.out).not.toContain("forge-value");
    expect(await readFile(path.join(cwd, "my-api/package.json"), "utf8")).toContain("my-api");
  });

  it("interactive selection uses the same flow without waiting in JSON mode", async () => {
    const cwd = await tmpDir();
    const answers = ["my-api", "worker", "crypto-utils", "local"];
    let out = "";
    const io: Io = { cwd, env: { KIT_CATALOG_ROOT: repo }, home: cwd, fetch, out: s => { out += s; }, err: s => { out += s; }, readStdin: async () => "", now: () => "2026-10-20T00:00:00Z", platform: process.platform, runner: async () => ({ exit: 0, output: "" }), prompt: async () => answers.shift()! };
    expect(await run(["bootstrap", "--no-git"], io), out).toBe(0);
    expect(answers).toEqual([]);
    io.prompt = async () => { throw new Error("must not prompt"); };
    expect(await run(["bootstrap", "--json"], io)).toBe(1);
  });
});
