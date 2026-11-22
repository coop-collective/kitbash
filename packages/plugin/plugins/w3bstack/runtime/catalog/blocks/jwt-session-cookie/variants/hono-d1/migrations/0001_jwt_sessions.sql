CREATE TABLE {{kit.tablePrefix}}jwt_session_owners (
  owner_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1))
);
CREATE TABLE {{kit.tablePrefix}}jwt_session_revocations (
  jti TEXT PRIMARY KEY,
  expires_s INTEGER NOT NULL
);
CREATE INDEX {{kit.tablePrefix}}jwt_session_revocations_expiry ON {{kit.tablePrefix}}jwt_session_revocations (expires_s);
