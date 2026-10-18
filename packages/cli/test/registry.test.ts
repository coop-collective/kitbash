/**
 * Against the in-process mock registry (no network): login, publish (signs), search, get, install from the registry
 * (both signatures verified), tampering, upgrade with a 3-way merge, propose, heartbeat.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { base64Encode, generateSigningKeyPair } from "@kitbash/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockRegistry, type MockRegistry } from "./mock-registry.ts";
import { FIXTURE_BLOCK, FIXTURE_ID, fixtureCopy, kit, planIdFrom, readJson, snapshot, templateCopy, tmpDir } from "./helpers.ts";

const API = "http://127.0.0.1:8787";
let reg: MockRegistry;
let home: string;

async function k(args: string[], cwd: string, extra: { env?: Record<string, string>; stdin?: string } = {}) {
  return kit(args, { cwd, fetch: reg.fetch, env: { KIT_HOME: home, ...(extra.env ?? {}) }, ...(extra.stdin !== undefined ? { stdin: extra.stdin } : {}) });
}

async function loginAndPublish(cwd: string, dir = FIXTURE_BLOCK) {
  expect((await k(["login", "--token", reg.token, "--api", API], cwd)).code).toBe(0);
  const p = await k(["publish", dir, "--visibility", "private"], cwd);
  expect(p.code, p.err).toBe(0);
  return p;
}

async function versionDir(version: string, edit?: (dir: string) => Promise<void>) {
  const dir = await fixtureCopy();
  const m = await readJson(path.join(dir, "block.json"));
  m.version = version;
  await writeFile(path.join(dir, "block.json"), JSON.stringify(m, null, 2));
  if (edit) await edit(dir);
  return dir;
}

beforeEach(async () => {
  reg = await createMockRegistry();
  home = await tmpDir("kit-home-");
});

describe("kit login / whoami", () => {
  it("saves the token 0600, pins the registry key and the default scope, never prints the token", async () => {
    const d = await tmpDir();
    const r = await k(["login", "--token", reg.token, "--api", API], d);
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain(reg.token);
    const file = path.join(home, "credentials");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const c = await readJson(file);
    expect(c).toMatchObject({ api_url: API, token: reg.token, registry_public_key: reg.key.publicKey, scope: "coop", member: "mem_owner" });
    const w = await k(["whoami"], d);
    expect(w.out).toMatch(/mem_owner · orgs @coop/);
  });

  it("reads a pasted token from stdin", async () => {
    const d = await tmpDir();
    const r = await k(["login", "--api", API], d, { stdin: `${reg.token}\n` });
    expect(r.code).toBe(0);
    expect((await readJson(path.join(home, "credentials"))).token).toBe(reg.token);
  });

  it("rejects a bad token, and refuses a changed registry key (trust on first use)", async () => {
    const d = await tmpDir();
    const bad = await k(["login", "--token", "kit_wrong_token_xx", "--api", API], d);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/unauthorized/);
    expect((await k(["login", "--token", reg.token, "--api", API], d)).code).toBe(0);
    const other = await createMockRegistry({ token: reg.token });
    reg = other; // same URL, different signing key
    const r = await k(["login", "--token", reg.token, "--api", API], d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/different signing key/);
  });
});

describe("kit publish / search / get", () => {
  it("publish signs with a generated member key; search and get answer from the registry", async () => {
    const d = await tmpDir();
    const p = await loginAndPublish(d);
    expect(p.out).toMatch(/generated a publisher key k_[0-9a-f]{16} \(stored in the file\)/);
    expect(p.out).toContain(`published ${FIXTURE_ID}@1.3.0 (private)`);
    expect((await stat(path.join(home, "keys", "publisher.json"))).mode & 0o777).toBe(0o600);
    const stored = reg.versions.get(`${FIXTURE_ID}@1.3.0`)!;
    expect(stored.manifest.provenance.publisher.org).toBe("@coop");

    const s = await k(["search", "email", "code", "--stack", "framework=hono,db=d1"], d);
    expect(s.code).toBe(0);
    expect(s.out).toContain(`${FIXTURE_ID}@1.3.0 · hono-d1`);
    expect(s.out).toMatch(/title \(author\): Email code sign-in/);
    expect(reg.requests.find((x) => x.path.startsWith("/api/search"))!.path).toMatch(/framework=hono&db=d1/);

    const g = await k(["get", FIXTURE_ID], d);
    expect(g.code).toBe(0);
    expect(g.out).toContain("verify: npx vitest run {{paths.tests}}/auth.test.ts ; npx tsc --noEmit");
    expect(g.out).toMatch(/┌─ UNTRUSTED AUTHOR TEXT[\s\S]*│ summary: Adds email-code sign-in[\s\S]*└─ end of untrusted author text ─/);

    const sk = await k(["get", FIXTURE_ID, "--detail", "skill"], d);
    expect(sk.out.split("\n").filter((l) => l.includes("## ")).every((l) => l.startsWith("│ "))).toBe(true);

    const again = await k(["publish", FIXTURE_BLOCK], d);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/conflicts.*version exists/);
  });

  it("publish refuses a public publish on client-scan warnings and never contacts the registry", async () => {
    const d = await tmpDir();
    expect((await k(["login", "--token", reg.token, "--api", API], d)).code).toBe(0);
    const blk = await fixtureCopy();
    const f = path.join(blk, "variants", "hono-d1", "src", "auth", "mail.ts");
    await writeFile(f, `${await readFile(f, "utf8")}\nexport const ping = () => fetch("https://tracker.example.net/x");\n`);
    const n = reg.requests.length;
    const r = await k(["publish", blk, "--visibility", "public"], d);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/refused/);
    expect(r.out).toMatch(/network_host/);
    expect(reg.requests.length).toBe(n);
  });

  it("get works on a local block directory offline", async () => {
    const d = await tmpDir();
    const r = await kit(["get", FIXTURE_BLOCK, "--json"], { cwd: d });
    expect(r.code).toBe(0);
    const s = JSON.parse(r.out);
    expect(s.detail).toBe("summary");
    expect(s.id).toBe("@local/email-code-auth-fixture");
    expect(s.untrusted_author_text.summary).toMatch(/Adds email-code sign-in/);
  });
});

describe("kit install from the registry", () => {
  it("verifies both signatures, plans, applies, and records the registry signature in the lock", async () => {
    const pub = await tmpDir();
    await loginAndPublish(pub);
    const d = await templateCopy();
    const before = await snapshot(d);
    const r = await k(["install", FIXTURE_ID], d);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`for ${FIXTURE_ID}@1.3.0`);
    expect(r.out).toContain("migrations: 0001_auth.sql → 0002_auth.sql");
    const mid = await snapshot(d);
    expect(Object.keys(mid).filter((x) => mid[x] !== before[x]).every((x) => x.startsWith(".kit/plans/"))).toBe(true);
    const a = await k(["install", FIXTURE_ID, "--apply", "--plan-id", planIdFrom(r.out)], d);
    expect(a.code, a.err).toBe(0);
    const lock = await readJson(path.join(d, ".kit", "lock.json"));
    expect(lock.blocks[FIXTURE_ID].registry_signature).toBe(reg.versions.get(`${FIXTURE_ID}@1.3.0`)!.registrySignature);
    expect((await readJson(path.join(d, ".kit", "sources.json")))[FIXTURE_ID]).toEqual({ kind: "registry" });
  });

  it("refuses a bundle whose file was tampered with, and writes nothing", async () => {
    await loginAndPublish(await tmpDir());
    reg.tamper = (b) => {
      const f = b.files.find((x: any) => x.path.endsWith("src/auth/codes.ts"));
      f.content_b64 = base64Encode(new TextEncoder().encode("export const pwned = 1;\n"));
    };
    const d = await templateCopy();
    const before = await snapshot(d);
    const r = await k(["install", FIXTURE_ID, "--apply"], d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/signature_invalid.*hash_mismatch/);
    const after = await snapshot(d);
    expect(Object.keys(after).filter((x) => after[x] !== before[x])).toEqual([]);
  });

  it("refuses a bundle with an undeclared extra file or an unsafe path", async () => {
    await loginAndPublish(await tmpDir());
    const d = await templateCopy();
    reg.tamper = (b) => b.files.push({ path: "variants/hono-d1/src/evil.ts", content_b64: base64Encode(new TextEncoder().encode("x")) });
    expect((await k(["install", FIXTURE_ID], d)).err).toMatch(/undeclared_file/);
    reg.tamper = (b) => b.files.push({ path: "../evil.ts", content_b64: "" });
    expect((await k(["install", FIXTURE_ID], d)).err).toMatch(/unsafe path/);
  });

  it("refuses when the registry signature does not verify against the pinned key", async () => {
    await loginAndPublish(await tmpDir());
    const other = await generateSigningKeyPair();
    const d = await templateCopy();
    const r = await k(["install", FIXTURE_ID], d, { env: { KIT_REGISTRY_PUBLIC_KEY: other.publicKey } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/registry signature does not verify/);
  });

  it("refuses a publisher key that is not the one named in the signed manifest", async () => {
    await loginAndPublish(await tmpDir());
    const other = await generateSigningKeyPair();
    reg.tamper = (b) => {
      b.publisher_key = other.publicKey;
    };
    const r = await k(["install", FIXTURE_ID], await templateCopy());
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/publisher key does not match/);
  });

  it("refuses registry installs when no registry key is pinned", async () => {
    const d = await templateCopy();
    const r = await k(["install", FIXTURE_ID], d, { env: { KIT_TOKEN: reg.token, KIT_API_URL: API } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no registry key is pinned/);
  });
});

describe("kit upgrade (3-way) and kit propose against the registry", () => {
  it("upgrade --to 1.1.0: clean merge for the untouched file, conflict for the edited one; --apply moves the lock", async () => {
    const pub = await tmpDir();
    const v1 = await versionDir("1.0.0");
    const v11 = await versionDir("1.1.0", async (dir) => {
      const codes = path.join(dir, "variants", "hono-d1", "src", "auth", "codes.ts");
      await writeFile(codes, (await readFile(codes, "utf8")).replace("const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 3;"));
      const mail = path.join(dir, "variants", "hono-d1", "src", "auth", "mail.ts");
      await writeFile(mail, `${await readFile(mail, "utf8")}// 1.1.0: documented the mail hook\n`);
      await writeFile(path.join(dir, "CHANGELOG.md"), `## 1.1.0\n\nFewer attempts.\n\n## Upgrade\n\nNothing to do.\n\n${await readFile(path.join(dir, "CHANGELOG.md"), "utf8")}`);
    });
    await loginAndPublish(pub, v1);
    const d = await templateCopy();
    expect((await k(["install", `${FIXTURE_ID}@1.0.0`, "--apply"], d)).code).toBe(0);
    expect((await k(["publish", v11], pub)).code).toBe(0);
    const codes = path.join(d, "src", "lib", "auth", "codes.ts");
    await writeFile(codes, (await readFile(codes, "utf8")).replace("const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 10;"));

    const dry = await k(["upgrade", FIXTURE_ID, "--to", "1.1.0", "--json"], d);
    expect(dry.code, dry.err).toBe(0);
    const up = JSON.parse(dry.out);
    expect(up.from).toBe("1.0.0");
    expect(up.to).toBe("1.1.0");
    expect(up.clean).toContain("src/lib/auth/mail.ts");
    expect(up.conflicted.map((c: any) => c.path)).toEqual(["src/lib/auth/codes.ts"]);
    expect(up.changelog_upgrade_section).toMatch(/Nothing to do/);
    expect(await readFile(path.join(d, "src", "lib", "auth", "mail.ts"), "utf8")).not.toContain("1.1.0");

    const human = await k(["upgrade", FIXTURE_ID, "--to", "1.1.0"], d);
    expect(human.out).toMatch(/┌─ UNTRUSTED AUTHOR TEXT[\s\S]*│ Nothing to do\./);

    const ap = await k(["upgrade", FIXTURE_ID, "--to", "1.1.0", "--apply"], d);
    expect(ap.code, ap.err).toBe(0);
    expect(await readFile(path.join(d, "src", "lib", "auth", "mail.ts"), "utf8")).toContain("// 1.1.0: documented the mail hook");
    const merged = await readFile(codes, "utf8");
    expect(merged).toContain("<<<<<<< ours (project)");
    expect(merged).toContain("const MAX_ATTEMPTS = 10;");
    expect(merged).toContain("const MAX_ATTEMPTS = 3;");
    expect((await readJson(path.join(d, ".kit", "lock.json"))).blocks[FIXTURE_ID].version).toBe("1.1.0");
  });

  it("upgrade works for a local block with --to-dir", async () => {
    const v1 = await versionDir("1.0.0");
    const v11 = await versionDir("1.1.0", async (dir) => {
      const mail = path.join(dir, "variants", "hono-d1", "src", "auth", "mail.ts");
      await writeFile(mail, `${await readFile(mail, "utf8")}// local 1.1.0\n`);
    });
    const d = await templateCopy();
    expect((await kit(["install", v1, "--apply"], { cwd: d })).code).toBe(0);
    const r = await kit(["upgrade", "@local/email-code-auth-fixture", "--to-dir", v11, "--apply"], { cwd: d });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/1\.0\.0 → 1\.1\.0 \(applied\)/);
    expect(await readFile(path.join(d, "src", "lib", "auth", "mail.ts"), "utf8")).toContain("// local 1.1.0");
  });

  it("propose submits the un-rendered patch to the registry", async () => {
    await loginAndPublish(await tmpDir());
    const d = await templateCopy();
    expect((await k(["install", FIXTURE_ID, "--param", "tokenPrefix=mc_", "--apply"], d)).code).toBe(0);
    const f = path.join(d, "src", "lib", "auth", "tokens.ts");
    await writeFile(f, (await readFile(f, "utf8")).replace('export const TOKEN_PREFIX = "mc_";', 'export const TOKEN_PREFIX = "mc_"; // greppable'));
    const r = await k(["propose", FIXTURE_ID, "--title", "Comment the prefix", "--why", "Clarity"], d);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("proposal prop_1 submitted");
    const sent = reg.proposals[0];
    expect(sent).toMatchObject({ block: `${FIXTURE_ID}@1.3.0`, title: "Comment the prefix", rationale: "Clarity" });
    expect(sent.patch).toContain('+export const TOKEN_PREFIX = "{{kit.tokenPrefix}}"; // greppable');
    const dry = await k(["propose", FIXTURE_ID, "--title", "t", "--why", "w", "--dry-run"], d);
    expect(dry.out).toMatch(/dry run: not submitted/);
    expect(reg.proposals).toHaveLength(1);
  });
});

describe("request shapes (WP-02 docs/API.md)", () => {
  it("publish sends publisher_key and every file but block.json; re-reading a pinned version allows yanked", async () => {
    await loginAndPublish(await tmpDir());
    const pubReq = reg.requests.find((r) => r.method === "POST" && r.path === "/api/blocks/coop/email-code-auth-fixture/versions")!;
    expect(pubReq.auth).toBe(`Bearer ${reg.token}`);
    expect(pubReq.body.publisher_key).toMatch(/^ed25519:/);
    expect(pubReq.body.visibility).toBe("private");
    const paths = pubReq.body.files.map((f: any) => f.path);
    expect(paths).toContain("CHANGELOG.md");
    expect(paths).toContain("variants/hono-d1/src/auth/codes.ts");
    expect(paths).not.toContain("block.json");
    expect(pubReq.body.manifest.files.every((f: any) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);

    const d = await templateCopy();
    expect((await k(["install", FIXTURE_ID, "--apply"], d)).code).toBe(0);
    expect(reg.requests.some((r) => r.path === "/api/blocks/coop/email-code-auth-fixture/1.3.0/bundle")).toBe(true);
    expect((await k(["diff", FIXTURE_ID], d)).code).toBe(0);
    expect(reg.requests.at(-1)!.path).toBe("/api/blocks/coop/email-code-auth-fixture/1.3.0/bundle?variant=hono-d1&allow_yanked=1");
  });
});

describe("kit heartbeat", () => {
  it("sends nothing unless telemetry is on, then only the lock's block list", async () => {
    await loginAndPublish(await tmpDir());
    const d = await templateCopy();
    expect((await k(["install", FIXTURE_ID, "--apply"], d)).code).toBe(0);
    const off = await k(["heartbeat", "--quiet"], d);
    expect(off.code).toBe(0);
    expect(off.out).toBe("");
    expect(reg.heartbeats).toHaveLength(0);
    await k(["init", "--telemetry"], d);
    const on = await k(["heartbeat"], d);
    expect(on.code).toBe(0);
    expect(reg.heartbeats).toHaveLength(1);
    expect(reg.heartbeats[0]!.projectId).toBe("prj_template_hono_d1");
    expect(reg.heartbeats[0]!.body.blocks).toEqual([{ block: FIXTURE_ID, version: "1.3.0", variant: "hono-d1", passed: false }]);
    expect(Object.keys(reg.heartbeats[0]!.body).sort()).toEqual(["blocks", "stack"]);
  });

  it("--quiet never fails, even when the registry is down", async () => {
    const d = await templateCopy();
    await kit(["init", "--telemetry", "--force"], { cwd: d });
    const r = await kit(["heartbeat", "--quiet"], { cwd: d, env: { KIT_TOKEN: "kit_x_token_123", KIT_HOME: home } });
    expect(r.code).toBe(0);
    expect(r.out + r.err).toBe("");
  });
});
