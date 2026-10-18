/**
 * WP-08 regression: `kit install` resolves registryDependencies itself and installs them first, in order, from local
 * block directories (siblings of the block, or --blocks-dir) and from the registry. Uses the repo's real blocks:
 * email-code-auth needs crypto-utils and cf-email-sender.
 */
import { cp } from "node:fs/promises";
import path from "node:path";
import { contract } from "@kitbash/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockRegistry, type MockRegistry } from "./mock-registry.ts";
import { kit, readJson, repo, snapshot, templateCopy, tmpDir } from "./helpers.ts";

const BLOCKS = path.join(repo, "blocks");
const ECA = path.join(BLOCKS, "email-code-auth");
const lockOf = async (d: string) => (await readJson(path.join(d, ".kit", "lock.json"))).blocks as Record<string, { params: Record<string, unknown> }>;

describe("kit install: registryDependencies from local block directories", () => {
  it("a dry run plans the dependencies first on an overlay and writes nothing outside .kit/", async () => {
    const d = await templateCopy();
    const before = await snapshot(d);
    const r = await kit(["install", ECA], { cwd: d });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/needs 2 block\(s\) installed first: @local\/crypto-utils@1\.\d+\.\d+ .*, @local\/cf-email-sender@/);
    // the block's own migration is numbered after nothing else (its dependencies ship no migrations) and the
    // second dependency's plan sees the first one's files
    expect(r.out.indexOf("Plan plan_")).toBeLessThan(r.out.indexOf("@local/email-code-auth@"));
    const after = await snapshot(d);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed.every((k) => k.startsWith(".kit/plans/") || k === ".kit/project.json")).toBe(true);
  });

  it("--apply installs the dependencies then the block, in order, with --param <dependency>.<name>", async () => {
    const d = await templateCopy();
    const r = await kit(["install", ECA, "--apply", "--param", "tokenPrefix=mc_", "--param", "cf-email-sender.mailer=console"], { cwd: d });
    expect(r.code, r.err + r.out).toBe(0);
    const lock = await lockOf(d);
    expect(Object.keys(lock)).toEqual(expect.arrayContaining(["@local/crypto-utils", "@local/cf-email-sender", "@local/email-code-auth"]));
    expect(lock["@local/cf-email-sender"]!.params.mailer).toBe("console");
    expect(lock["@local/email-code-auth"]!.params.tokenPrefix).toBe("mc_");
    expect(r.out.indexOf("Installed dependency @local/crypto-utils")).toBeLessThan(r.out.indexOf("Installed dependency @local/cf-email-sender"));
    const sources = await readJson(path.join(d, ".kit", "sources.json"));
    expect(sources["@local/crypto-utils"].kind).toBe("local");
  });

  it("the dry run's plan id pins the apply (--plan-id), as the plugin's registry_install does", async () => {
    const d = await templateCopy();
    const dry = await kit(["install", ECA, "--json"], { cwd: d });
    expect(dry.code, dry.err).toBe(0);
    const plan = JSON.parse(dry.out);
    expect(contract.Plan.safeParse(plan).success).toBe(true);
    expect(plan.dependencies.map((x: { block: string }) => x.block.replace(/@[^@]+$/, ""))).toEqual(["@local/crypto-utils", "@local/cf-email-sender"]);
    const ok = await kit(["install", ECA, "--json", "--apply", "--plan-id", plan.plan_id], { cwd: d });
    expect(ok.code, ok.out + ok.err).toBe(0);
    const applied = JSON.parse(ok.out);
    expect(contract.AppliedPlan.safeParse(applied).success).toBe(true);
    expect(applied.plan_id).toBe(plan.plan_id);
    expect(applied.dependencies.every((x: { applied: boolean }) => x.applied)).toBe(true);
  });

  it("installed dependencies are skipped; --no-deps skips resolution; a missing dependency names --blocks-dir", async () => {
    const d = await templateCopy();
    expect((await kit(["install", path.join(BLOCKS, "crypto-utils"), "--apply"], { cwd: d })).code).toBe(0);
    const r = await kit(["install", ECA], { cwd: d });
    expect(r.out).toMatch(/needs 1 block\(s\) installed first: @local\/cf-email-sender@/);
    const solo = await kit(["install", ECA, "--no-deps"], { cwd: d });
    expect(solo.out).not.toMatch(/needs \d+ block\(s\) installed first/);

    // a copy of the block outside blocks/: its siblings are gone, so --blocks-dir is needed
    const alone = await tmpDir("kit-alone-");
    await cp(ECA, path.join(alone, "email-code-auth"), { recursive: true });
    const miss = await kit(["install", path.join(alone, "email-code-auth")], { cwd: await templateCopy() });
    expect(miss.code).toBe(1);
    expect(miss.err).toMatch(/--blocks-dir/);
    const found = await kit(["install", path.join(alone, "email-code-auth"), "--blocks-dir", BLOCKS], { cwd: await templateCopy() });
    expect(found.code, found.err).toBe(0);
  });

  it("a dependency with conflicts stops everything; nothing is written", async () => {
    const d = await templateCopy();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(d, "src", "lib"), { recursive: true });
    await writeFile(path.join(d, "src", "lib", "crypto.ts"), "export const mine = 1;\n");
    const before = await snapshot(d);
    const r = await kit(["install", ECA, "--apply"], { cwd: d });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/conflicts/);
    const after = await snapshot(d);
    expect(Object.keys(after).filter((k) => after[k] !== before[k] && !k.startsWith(".kit/plans/") && k !== ".kit/project.json")).toEqual([]);
  });
});

describe("kit install: registryDependencies from the registry", () => {
  const API = "http://127.0.0.1:8787";
  let reg: MockRegistry;
  let home: string;
  const k = (args: string[], cwd: string) => kit(args, { cwd, fetch: reg.fetch, env: { KIT_HOME: home } });

  beforeEach(async () => {
    reg = await createMockRegistry();
    home = await tmpDir("kit-home-");
  });

  it("resolves @coop/<dependency>@<range> to the highest published version and installs it first", async () => {
    const d = await tmpDir();
    expect((await k(["login", "--token", reg.token, "--api", API], d)).code).toBe(0);
    for (const b of ["crypto-utils", "cf-email-sender", "email-code-auth"]) {
      const p = await k(["publish", path.join(BLOCKS, b), "--visibility", "private"], d);
      expect(p.code, p.err + p.out).toBe(0);
    }
    const proj = await templateCopy();
    const r = await k(["install", "@coop/email-code-auth", "--apply"], proj);
    expect(r.code, r.err + r.out).toBe(0);
    const lock = await lockOf(proj);
    expect(Object.keys(lock).sort()).toEqual(["@coop/cf-email-sender", "@coop/crypto-utils", "@coop/email-code-auth"]);
    expect((await readJson(path.join(proj, ".kit", "sources.json")))["@coop/crypto-utils"].kind).toBe("registry");
  });
});
