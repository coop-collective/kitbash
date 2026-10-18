-- email-code-auth: accounts, bearer tokens and one-time sign-in codes. Times are epoch milliseconds.
-- Tokens and codes are stored only as HMAC-SHA256 under keys derived from the TOKEN_PEPPER secret.
CREATE TABLE members (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE member_tokens (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX member_tokens_member ON member_tokens(member_id);

CREATE TABLE login_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_codes_email ON login_codes(email, created_at);
CREATE INDEX login_codes_created ON login_codes(created_at);
