-- kit-api schema, MVP subset of DESIGN.md §6.2 (the ● tables) plus publisher_keys and proposals, which the MVP's
-- publish and propose routes need. Ids are global with a prefix (org_, mem_, tok_, blk_, ver_, prj_, prop_), so a
-- record never collides across orgs. Timestamps are ISO-8601 UTC strings (sortable, and the contract's form).
-- Every block-scoped row is reachable from blocks.org_id; every query filters by the caller's orgs.

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,                       -- the scope without '@': coop -> @coop
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'team')),
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  default_org_id TEXT REFERENCES orgs(id),
  created_at TEXT NOT NULL
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, member_id)
);
CREATE INDEX org_members_member ON org_members(member_id);

-- Opaque kit_ bearer tokens; only HMAC-SHA256(TOKEN_PEPPER, token) is stored.
CREATE TABLE member_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- Publisher Ed25519 keys (ed25519:<base64url>), registered to a member on first publish (MVP: trust on first use).
CREATE TABLE publisher_keys (
  id TEXT PRIMARY KEY,                             -- core keyIdOf(): k_<16 hex>
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  license TEXT NOT NULL,
  price_cents INTEGER,
  pricing_model TEXT,
  forkable TEXT NOT NULL DEFAULT 'none' CHECK (forkable IN ('public', 'purchasers', 'none')),
  origin TEXT,
  created_at TEXT NOT NULL,
  yanked_at TEXT,
  UNIQUE (org_id, name)
);

-- One row per published version; immutable except status/yank fields. The search columns (title … stack_text) are
-- denormalized from the manifest at publish and mirrored into block_search by the triggers below.
CREATE TABLE block_versions (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  version TEXT NOT NULL,
  prerelease INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL,                     -- as signed, plus provenance.signature/registry_signature
  manifest_sha256 TEXT NOT NULL,
  publisher_sig TEXT NOT NULL,
  publisher_key_id TEXT REFERENCES publisher_keys(id),
  registry_sig TEXT NOT NULL,
  scan_tier TEXT NOT NULL DEFAULT 'unreviewed' CHECK (scan_tier IN ('unreviewed', 'scanned', 'verified', 'curated')),
  scan_json TEXT NOT NULL DEFAULT '[]',
  sandbox_json TEXT,
  size_json TEXT NOT NULL,
  cards_json TEXT NOT NULL,                        -- {variant_id: Card} precomputed at publish
  changelog_md TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'yanked')),
  published_by TEXT REFERENCES members(id),
  published_at TEXT NOT NULL,
  yanked_at TEXT,
  yank_reason TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '',
  tables_text TEXT NOT NULL DEFAULT '',
  routes_text TEXT NOT NULL DEFAULT '',
  stack_text TEXT NOT NULL DEFAULT '',
  UNIQUE (block_id, version)
);

-- Files of a version. path is the block-relative (bundle) path; file_path is files[].path (variant-relative).
-- Meta files (CHANGELOG.md, SKILL.md, docs, LICENSE) have role 'meta' unless also declared. Content: R2
-- orgs/<org_id>/blobs/<sha256>.
CREATE TABLE block_files (
  version_id TEXT NOT NULL REFERENCES block_versions(id),
  path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  variant TEXT,
  target TEXT,
  role TEXT NOT NULL,
  merge TEXT,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (version_id, path)
);

CREATE TABLE block_tags (
  block_id TEXT NOT NULL REFERENCES blocks(id),
  tag TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES block_versions(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (block_id, tag)
);

-- Full-text search over every version; queries join back to block_versions and keep each block's `latest`.
CREATE VIRTUAL TABLE block_search USING fts5(
  version_id UNINDEXED,
  title,
  description,
  categories,
  tables,
  routes,
  stack,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER block_versions_search_insert AFTER INSERT ON block_versions BEGIN
  INSERT INTO block_search (version_id, title, description, categories, tables, routes, stack)
  VALUES (new.id, new.title, new.description, new.categories, new.tables_text, new.routes_text, new.stack_text);
END;

CREATE TRIGGER block_versions_search_update AFTER UPDATE OF title, description, categories, tables_text, routes_text, stack_text ON block_versions BEGIN
  DELETE FROM block_search WHERE version_id = old.id;
  INSERT INTO block_search (version_id, title, description, categories, tables, routes, stack)
  VALUES (new.id, new.title, new.description, new.categories, new.tables_text, new.routes_text, new.stack_text);
END;

CREATE TRIGGER block_versions_search_delete AFTER DELETE ON block_versions BEGIN
  DELETE FROM block_search WHERE version_id = old.id;
END;

-- Usage (DESIGN §4.5): a project is one .kit/project.json; installs come from its lock via heartbeats.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  stack_json TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_member_id TEXT REFERENCES members(id)
);

CREATE TABLE installs (
  project_id TEXT NOT NULL REFERENCES projects(id),
  block_id TEXT NOT NULL REFERENCES blocks(id),
  version_id TEXT NOT NULL REFERENCES block_versions(id),
  variant TEXT,
  installed_at TEXT NOT NULL,
  verified_at TEXT,
  passed INTEGER,
  removed_at TEXT,
  PRIMARY KEY (project_id, block_id)
);
CREATE INDEX installs_block ON installs(block_id);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id),
  base_version_id TEXT NOT NULL REFERENCES block_versions(id),
  proposer_id TEXT NOT NULL REFERENCES members(id),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  patch_key TEXT NOT NULL,
  hunks INTEGER NOT NULL DEFAULT 0,
  stack_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'accepted', 'declined')),
  result_version_id TEXT REFERENCES block_versions(id),
  created_at TEXT NOT NULL
);

-- Audit log (DESIGN §5.7).
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,
  member_id TEXT,
  kind TEXT NOT NULL,
  ref TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX events_org ON events(org_id, created_at);
