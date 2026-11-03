// CLI sign-ins: a person's own CLI that signed in with their account over OAuth ("My CLI on this computer"). The OAuth
// grant's userId is the row's id; the row is checked on every call, so a revoke is immediate.
import { memberById } from "./identity";
import type { CliLogin, CliProps, OAuthEnv, OAuthMember } from "./types";

const SEEN_EVERY_MS = 30_000;

function newId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export async function createCliLogin(
  env: OAuthEnv,
  memberId: string,
  input: { label: string; client_id: string | null; client_name: string | null; redirect_host: string | null; loopback: boolean },
): Promise<CliLogin> {
  const row: CliLogin = {
    id: newId("cli"),
    member_id: memberId,
    label: input.label.trim().slice(0, 80) || input.client_name?.slice(0, 80) || "CLI",
    client_id: input.client_id,
    client_name: input.client_name?.slice(0, 120) ?? null,
    redirect_host: input.redirect_host?.slice(0, 200) ?? null,
    loopback: input.loopback ? 1 : 0,
    created_at: Date.now(),
    last_seen_at: null,
    revoked_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO {{kit.tablePrefix}}cli_logins (id, member_id, label, client_id, client_name, redirect_host, loopback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.member_id, row.label, row.client_id, row.client_name, row.redirect_host, row.loopback, row.created_at)
    .run();
  return row;
}

export async function getCliLogin(env: OAuthEnv, id: string): Promise<CliLogin | null> {
  return env.DB.prepare("SELECT * FROM {{kit.tablePrefix}}cli_logins WHERE id = ?").bind(id).first<CliLogin>();
}

/** The live sign-in and its person, or null (revoked, or the person is gone). Marks it seen at most every 30 s. */
export async function cliMember(env: OAuthEnv, props: CliProps): Promise<{ login: CliLogin; member: OAuthMember } | null> {
  const login = await getCliLogin(env, props.cli_id);
  if (!login || login.revoked_at || login.member_id !== props.member_id) return null;
  const member = await memberById(env, login.member_id);
  if (!member) return null;
  const t = Date.now();
  if (!login.last_seen_at || t - login.last_seen_at > SEEN_EVERY_MS) {
    await env.DB.prepare("UPDATE {{kit.tablePrefix}}cli_logins SET last_seen_at = ? WHERE id = ?").bind(t, login.id).run();
    login.last_seen_at = t;
  }
  return { login, member };
}

export async function listCliLogins(env: OAuthEnv, memberId: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, label, client_name, redirect_host, loopback, created_at, last_seen_at FROM {{kit.tablePrefix}}cli_logins WHERE member_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
  )
    .bind(memberId)
    .all();
  return results;
}

/** Revoke one of my CLI sign-ins; null when it is not mine (callers answer 404). The caller also deletes its grants. */
export async function revokeCliLogin(env: OAuthEnv, memberId: string, id: string): Promise<CliLogin | null> {
  const row = await getCliLogin(env, id);
  if (!row || row.member_id !== memberId) return null;
  if (!row.revoked_at) await env.DB.prepare("UPDATE {{kit.tablePrefix}}cli_logins SET revoked_at = ? WHERE id = ?").bind(Date.now(), id).run();
  return row;
}
