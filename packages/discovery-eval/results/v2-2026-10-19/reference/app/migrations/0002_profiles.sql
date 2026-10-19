CREATE TABLE profiles (
  owner_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  avatar_id TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  nonce TEXT NOT NULL
);
