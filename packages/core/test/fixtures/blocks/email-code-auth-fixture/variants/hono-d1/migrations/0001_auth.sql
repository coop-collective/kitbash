-- email-code-auth: members, their bearer tokens (HMAC only), and one-time login codes (HMAC only).
CREATE TABLE {{kit.tablePrefix}}members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE {{kit.tablePrefix}}member_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES {{kit.tablePrefix}}members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE {{kit.tablePrefix}}login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX {{kit.tablePrefix}}login_codes_email ON {{kit.tablePrefix}}login_codes(email, created_at);
