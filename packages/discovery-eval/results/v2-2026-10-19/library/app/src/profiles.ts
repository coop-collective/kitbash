export interface Profile { handle: string; display_name: string; bio: string; avatar_id: string | null; is_public: boolean }
export interface ProfileState { profile: Profile; revision: number; nonce: string }

const EMPTY: Profile = { handle: '', display_name: '', bio: '', avatar_id: null, is_public: false };

interface Row { handle: string; display_name: string; bio: string; avatar_id: string | null; is_public: number; revision: number; nonce: string }

/** Authoritative read straight from D1; never cached. */
export async function loadProfile(db: D1Database, ownerId: string): Promise<ProfileState> {
  const row = await db.prepare('SELECT handle, display_name, bio, avatar_id, is_public, revision, nonce FROM member_profiles WHERE owner_id = ?').bind(ownerId).first<Row>();
  if (!row) return { profile: { ...EMPTY }, revision: 0, nonce: 'none' };
  return {
    profile: { handle: row.handle, display_name: row.display_name, bio: row.bio, avatar_id: row.avatar_id, is_public: row.is_public === 1 },
    revision: row.revision,
    nonce: row.nonce,
  };
}

export interface Input extends Profile { revision: number }

/** Returns an error message, or the validated input. */
export function validateProfile(body: unknown): Input | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'JSON object required';
  const b = body as Record<string, unknown>;
  if (typeof b.handle !== 'string' || !/^[a-z0-9_]{3,30}$/.test(b.handle)) return 'handle must be 3-30 lowercase letters, digits or underscore';
  if (typeof b.display_name !== 'string' || b.display_name.length < 1 || b.display_name.length > 80) return 'display_name must be 1-80 characters';
  if (typeof b.bio !== 'string' || b.bio.length > 500) return 'bio must be at most 500 characters';
  if (b.avatar_id !== null) return 'avatar_id must be null';
  if (typeof b.is_public !== 'boolean') return 'is_public must be a boolean';
  if (typeof b.revision !== 'number' || !Number.isSafeInteger(b.revision) || b.revision < 0) return 'revision must be a non-negative integer';
  return { handle: b.handle, display_name: b.display_name, bio: b.bio, avatar_id: null, is_public: b.is_public, revision: b.revision };
}

export type SaveResult = { ok: true } | { ok: false; reason: 'stale' | 'handle_taken' };

/** Optimistic concurrency: the write only applies when the stored revision equals the caller's. */
export async function saveProfile(db: D1Database, ownerId: string, input: Input): Promise<SaveResult> {
  const nonce = crypto.randomUUID();
  const now = Date.now();
  try {
    const result = input.revision === 0
      ? await db.prepare('INSERT INTO member_profiles (owner_id, handle, display_name, bio, avatar_id, is_public, revision, nonce, updated_ms) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?) ON CONFLICT(owner_id) DO NOTHING')
        .bind(ownerId, input.handle, input.display_name, input.bio, input.is_public ? 1 : 0, nonce, now).run()
      : await db.prepare('UPDATE member_profiles SET handle = ?, display_name = ?, bio = ?, avatar_id = NULL, is_public = ?, revision = revision + 1, nonce = ?, updated_ms = ? WHERE owner_id = ? AND revision = ?')
        .bind(input.handle, input.display_name, input.bio, input.is_public ? 1 : 0, nonce, now, ownerId, input.revision).run();
    return result.meta.changes === 1 ? { ok: true } : { ok: false, reason: 'stale' };
  } catch (error) {
    if (String(error).includes('UNIQUE')) return { ok: false, reason: 'handle_taken' };
    throw error;
  }
}
