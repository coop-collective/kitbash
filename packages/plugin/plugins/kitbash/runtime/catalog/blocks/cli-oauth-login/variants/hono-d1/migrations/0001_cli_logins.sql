-- cli-oauth-login: one row per approved "My CLI on this computer" sign-in. A person's own CLI (Claude Code, Codex,
-- Cursor, Grok) signs in with their account over OAuth instead of a pasted token and then acts as that person. The
-- OAuth grant's userId is the row's id and the row is checked on every call, so revoking it signs that CLI out at once.
-- Times are epoch milliseconds. loopback = 1 when the redirect went to this computer (127.0.0.1, localhost, [::1]).
CREATE TABLE {{kit.tablePrefix}}cli_logins (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES {{kit.authTablePrefix}}members(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  client_id TEXT,
  client_name TEXT,
  redirect_host TEXT,
  loopback INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX {{kit.tablePrefix}}cli_logins_member ON {{kit.tablePrefix}}cli_logins(member_id, created_at);
