// Shared by the local dev scripts: wrangler against the LOCAL D1 state (.wrangler/state), never remote.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DB = "DB";

// KIT_PERSIST=<dir>: use that local state directory instead of .wrangler/state (an isolated e2e run with
// `wrangler dev --persist-to <dir>`). Only ever added to --local calls.
export function wrangler(args, { quiet = true } = {}) {
  if (process.env.KIT_PERSIST && args.includes("--local")) args = [...args, "--persist-to", process.env.KIT_PERSIST];
  return execFileSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
}

export function migrateLocal() {
  wrangler(["d1", "migrations", "apply", DB, "--local"]);
}

/** Executes SQL against the local D1 and returns the parsed result rows of the last statement. */
export function sql(command) {
  const out = wrangler(["d1", "execute", DB, "--local", "--json", "--command", command]);
  const parsed = JSON.parse(out);
  return parsed[parsed.length - 1]?.results ?? [];
}

export const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Reads KEY=value pairs from packages/api/.dev.vars (what `wrangler dev` uses). */
export function devVars() {
  const p = path.join(root, ".dev.vars");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** The @coop org and its owner (MVP: one personal org). Idempotent; returns {orgId, memberId}. */
export function ensureOwner({ slug = "coop", email, name }) {
  const orgId = `org_${slug.replace(/[^a-z0-9]/g, "_")}`;
  const memberId = `mem_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
  const t = now();
  sql(
    [
      `INSERT OR IGNORE INTO orgs (id, slug, name, kind, plan, created_at) VALUES (${q(orgId)}, ${q(slug)}, ${q(name)}, 'personal', 'free', ${q(t)})`,
      `INSERT OR IGNORE INTO members (id, email, name, default_org_id, created_at) VALUES (${q(memberId)}, ${q(email.toLowerCase())}, ${q(name)}, ${q(orgId)}, ${q(t)})`,
      `INSERT OR IGNORE INTO org_members (org_id, member_id, role, created_at) VALUES (${q(orgId)}, ${q(memberId)}, 'owner', ${q(t)})`,
    ].join("; "),
  );
  const org = sql(`SELECT id FROM orgs WHERE slug = ${q(slug)}`)[0];
  const member = sql(`SELECT id FROM members WHERE email = ${q(email.toLowerCase())}`)[0];
  return { orgId: org?.id ?? orgId, memberId: member?.id ?? memberId };
}
