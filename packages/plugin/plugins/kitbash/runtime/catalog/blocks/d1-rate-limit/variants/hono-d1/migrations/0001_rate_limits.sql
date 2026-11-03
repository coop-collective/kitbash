CREATE TABLE {{kit.tablePrefix}}rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX {{kit.tablePrefix}}rate_limits_expiry ON {{kit.tablePrefix}}rate_limits(expires_at);
