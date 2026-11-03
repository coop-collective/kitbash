CREATE TABLE {{kit.tablePrefix}}browser_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  revoked_ms INTEGER
);
CREATE INDEX {{kit.tablePrefix}}browser_sessions_owner ON {{kit.tablePrefix}}browser_sessions(owner_id);
CREATE INDEX {{kit.tablePrefix}}browser_sessions_expiry ON {{kit.tablePrefix}}browser_sessions(expires_ms);
