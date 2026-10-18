// Shared test helpers: orgs and members with kit_ tokens, calls into the Worker, the WP-01 fixture block signed by a
// per-test publisher key, and an MCP SDK client wired to the Worker. Keys are generated here; nothing is committed.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { base64Encode, fillFileHashes, generateSigningKeyPair, signBundle, toBytes, type SigningKeyPair } from "@kitbash/core";
import { env, exports } from "cloudflare:workers";
import { issueToken } from "../src/auth";
import type { Bindings } from "../src/types";
import { newId, now } from "../src/util";

export const ORIGIN = "http://kit.test";
export const E = env as unknown as Bindings & { TEST_FIXTURE_BLOCK: string; PROD_SIM_DB: D1Database };

export interface TestMember {
  id: string;
  token: string;
  org: { id: string; slug: string };
}

/** An org (created when missing) and a new member in it with a fresh token. */
export async function member(slug = `t${crypto.randomUUID().slice(0, 8)}`, role: "owner" | "admin" | "member" = "owner"): Promise<TestMember> {
  let org = await E.DB.prepare("SELECT id, slug FROM orgs WHERE slug = ?").bind(slug).first<{ id: string; slug: string }>();
  if (!org) {
    org = { id: newId("org"), slug };
    await E.DB.prepare("INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)").bind(org.id, slug, slug, now()).run();
  }
  const id = newId("mem");
  await E.DB.batch([
    E.DB.prepare("INSERT INTO members (id, email, name, default_org_id, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, `${id}@example.test`, "Tester", org.id, now()),
    E.DB.prepare("INSERT INTO org_members (org_id, member_id, role, created_at) VALUES (?, ?, ?, ?)").bind(org.id, id, role, now()),
  ]);
  return { id, token: await issueToken(E, id, "test"), org };
}

export async function call(path: string, opts: { method?: string; token?: string | null; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const res = await exports.default.fetch(
    new Request(ORIGIN + path, {
      method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
      headers,
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    }),
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

export type Tree = Record<string, string | Uint8Array>;

/** The WP-01 fixture block (packages/core/test/fixtures/blocks/email-code-auth-fixture), fresh copy. */
export function fixture(): { manifest: Record<string, any>; files: Tree } {
  const b = JSON.parse(E.TEST_FIXTURE_BLOCK) as { manifest: Record<string, any>; files: Record<string, string> };
  return { manifest: b.manifest, files: { ...b.files } };
}

const keys = new Map<string, Promise<SigningKeyPair>>();
/** One publisher key per member (a key is bound to the first member who publishes with it). */
export function publisherKey(memberId: string): Promise<SigningKeyPair> {
  let k = keys.get(memberId);
  if (!k) keys.set(memberId, (k = generateSigningKeyPair()));
  return k;
}

export interface PublishOpts {
  name?: string;
  version?: string;
  key?: SigningKeyPair;
  edit?: (m: Record<string, any>, files: Tree) => void;
  visibility?: "private" | "public";
  tag?: string;
}

/** A signed publish body for the fixture block (optionally renamed, re-versioned or edited before signing). */
export async function publishBody(opts: PublishOpts = {}) {
  const { manifest, files } = fixture();
  if (opts.name) {
    manifest.name = opts.name;
    for (const f of manifest.files) if (typeof f.target === "string") f.target = f.target.replace("email-code-auth-fixture", opts.name);
    files["SKILL.md"] = String(files["SKILL.md"]).replace(/^name: .*$/m, `name: ${opts.name}`);
  }
  if (opts.version) manifest.version = opts.version;
  opts.edit?.(manifest, files);
  const key = opts.key ?? (await generateSigningKeyPair());
  const filled = await fillFileHashes(manifest, files);
  const signature = await signBundle(filled, files, key.privateKeyJwk);
  return {
    manifest: filled,
    files: Object.entries(files).map(([path, data]) => ({ path, content_b64: base64Encode(toBytes(data)) })),
    publisher_signature: signature,
    publisher_key: key.publicKey,
    ...(opts.visibility ? { visibility: opts.visibility } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}),
  };
}

/** Publishes the fixture (or a variation) into `who`'s org; returns the response. */
export async function publishFixture(who: TestMember, opts: PublishOpts = {}) {
  const body = await publishBody({ ...opts, key: opts.key ?? (await publisherKey(who.id)) });
  return call(`/api/blocks/${who.org.slug}/${body.manifest.name}/versions`, { token: who.token, body });
}

export async function mcp(token: string): Promise<Client> {
  const client = new Client({ name: "kit-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/** Calls an MCP tool and parses its JSON text content. */
export async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r: any = await client.callTool({ name, arguments: args });
  const text: string = r.content?.[0]?.text ?? "";
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { isError: !!r.isError, text, data, structured: r.structuredContent };
}
