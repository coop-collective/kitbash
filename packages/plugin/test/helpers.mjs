import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createKitServer } from "../plugins/kitbash/scripts/server.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(here, "..");
export const repo = path.resolve(here, "../../..");
export const TEMPLATE = path.join(repo, "test-e2e", "fixtures", "hono-d1");
export const FIXTURE_BLOCK = path.join(repo, "packages", "core", "test", "fixtures", "blocks", "email-code-auth-fixture");
export const NOW = "2026-10-20T10:11:12.000Z";
export const API = "http://127.0.0.1:8787";
export const execFileP = promisify(execFile);

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

export async function tmpDir(prefix = "kit-plugin-") {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A temp copy of test-e2e/fixtures/hono-d1 without node_modules. */
export async function templateCopy() {
  const d = await tmpDir("kit-plugin-proj-");
  await cp(TEMPLATE, d, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.wrangler|dist)(\/|$)/.test(path.relative(TEMPLATE, src)) });
  return d;
}

export async function fixtureCopy() {
  const d = await tmpDir("kit-plugin-block-");
  await cp(FIXTURE_BLOCK, d, { recursive: true });
  return d;
}

export const noNetwork = async () => {
  throw new Error("network is not allowed in tests");
};

/** An in-process MCP client connected to a kit server (no sockets, no child process). */
export async function connect(opts = {}) {
  const home = opts.home ?? (await tmpDir("kit-plugin-home-"));
  const server = createKitServer({
    cwd: opts.cwd ?? (await tmpDir("kit-plugin-cwd-")),
    env: { PATH: process.env.PATH, KIT_HOME: home, KIT_KEYCHAIN: "0", ...(opts.env ?? {}) },
    home,
    fetch: opts.fetch ?? noNetwork,
    runner: opts.runner ?? (async () => { throw new Error("the runner must not be called"); }),
    now: () => NOW,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "kit-test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  after(async () => {
    await client.close();
  });
  return client;
}

/** Calls a tool; returns {isError, data} where data is the parsed JSON text. */
export async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { isError: r.isError === true, data, raw: r };
}

export async function snapshot(dir, skip = /(^|\/)(node_modules|\.kit)(\/|$)/) {
  const out = {};
  const walk = async (rel) => {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip.test(r)) continue;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) out[r] = await readFile(path.join(dir, r), "utf8");
    }
  };
  await walk("");
  return out;
}

export async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
