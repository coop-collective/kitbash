export type ProfileEnv = { DB: D1Database };
export type ProfileFields = { handle: string; display_name: string; bio: string; avatar_id: number | null; is_public: boolean };
export type Profile = ProfileFields & { revision: number; updated_ms: number };
export type ProfileInput = ProfileFields & { revision: number };
type Row = Omit<Profile, "is_public"> & { is_public: number };
const columns = "handle, display_name, bio, avatar_id, is_public, revision, updated_ms";
const view = (row: Row): Profile => ({ ...row, is_public: row.is_public === 1 });
const text = (value: unknown, max: number, empty: boolean): string | null => {
  if (typeof value !== "string") return null;
  const s = value.normalize("NFC").trim();
  return s.length <= max && (empty || s.length > 0) && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
};
export function parseProfile(value: unknown): ProfileInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const allowed = ["handle", "display_name", "bio", "avatar_id", "is_public", "revision"];
  if (Object.keys(o).some(k => !allowed.includes(k))) return null;
  if (typeof o.handle !== "string") return null;
  const handle = o.handle;
  const displayName = text(o.display_name, 80, false);
  const bio = text(o.bio, 500, true);
  if (!/^[a-z0-9_]{3,30}$/.test(handle) || displayName === null || bio === null) return null;
  if (o.avatar_id !== null && !(typeof o.avatar_id === "number" && Number.isInteger(o.avatar_id) && o.avatar_id >= 1 && o.avatar_id <= 19)) return null;
  if (typeof o.is_public !== "boolean" || typeof o.revision !== "number" || !Number.isSafeInteger(o.revision) || o.revision < 0 || o.revision >= Number.MAX_SAFE_INTEGER) return null;
  return { handle, display_name: displayName, bio, avatar_id: o.avatar_id as number | null, is_public: o.is_public, revision: o.revision };
}
export async function getProfile(env: ProfileEnv, ownerId: string): Promise<Profile | null> {
  const row = await env.DB.prepare(`SELECT ${columns} FROM member_profiles WHERE owner_id = ?`).bind(ownerId).first<Row>();
  return row ? view(row) : null;
}
/** Complete replacement with compare-and-swap revision; never a read followed by an unconditional write. */
export async function saveProfile(env: ProfileEnv, ownerId: string, value: unknown, now = Date.now()): Promise<{ ok: true; profile: Profile } | { ok: false; error: "invalid_profile" | "conflict" }> {
  const p = parseProfile(value);
  if (!p || !ownerId || ownerId.length > 256) return { ok: false, error: "invalid_profile" };
  let row: Row | null;
  try {
    row = p.revision === 0
      ? await env.DB.prepare(`INSERT INTO member_profiles (owner_id, handle, display_name, bio, avatar_id, is_public, revision, updated_ms) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT DO NOTHING RETURNING ${columns}`)
        .bind(ownerId, p.handle, p.display_name, p.bio, p.avatar_id, Number(p.is_public), now).first<Row>()
      : await env.DB.prepare(`UPDATE member_profiles SET handle = ?, display_name = ?, bio = ?, avatar_id = ?, is_public = ?, revision = revision + 1, updated_ms = ? WHERE owner_id = ? AND revision = ? RETURNING ${columns}`)
        .bind(p.handle, p.display_name, p.bio, p.avatar_id, Number(p.is_public), now, ownerId, p.revision).first<Row>();
  } catch (error) {
    // A concurrent handle claim is still a conflict. Storage outages must reach the host error boundary.
    if (error instanceof Error && /UNIQUE constraint failed: member_profiles\.handle/.test(error.message)) return { ok: false, error: "conflict" };
    throw error;
  }
  return row ? { ok: true, profile: view(row) } : { ok: false, error: "conflict" };
}
export async function getPublicProfile(env: ProfileEnv, handle: string): Promise<Pick<Profile, "handle" | "display_name" | "bio" | "avatar_id"> | null> {
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) return null;
  return env.DB.prepare(`SELECT handle, display_name, bio, avatar_id FROM member_profiles WHERE handle = ? AND is_public = 1`).bind(handle).first();
}
