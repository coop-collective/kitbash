CREATE TABLE {{kit.tablePrefix}}api_keys (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT '',
  created_ms   INTEGER NOT NULL,
  last_used_ms INTEGER,
  revoked_ms   INTEGER
);
CREATE INDEX {{kit.tablePrefix}}api_keys_owner ON {{kit.tablePrefix}}api_keys(owner_id, revoked_ms);
