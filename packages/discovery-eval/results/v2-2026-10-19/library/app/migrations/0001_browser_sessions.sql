CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  revoked_ms INTEGER
);
CREATE INDEX browser_sessions_owner ON browser_sessions(owner_id);
CREATE INDEX browser_sessions_expiry ON browser_sessions(expires_ms);
