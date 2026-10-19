-- Key/value metadata about this app (schema version, install markers). Blocks add their own tables in later migrations.
CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO meta (key, value) VALUES ('schema', 'init');
