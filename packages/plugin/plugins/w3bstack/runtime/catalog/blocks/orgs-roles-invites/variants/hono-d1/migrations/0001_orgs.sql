-- orgs-roles-invites: every account gets a personal workspace, anyone can create a team org and invite people into
-- it by email. The app's records carry org_id and are scoped with orgOf(env). Times are epoch milliseconds.

CREATE TABLE {{kit.tablePrefix}}orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- personal: the one workspace an account gets (one member, never deleted or shared); team: created by someone
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'team')),
  -- the person a personal workspace belongs to (NULL for a team)
  personal_of TEXT REFERENCES {{kit.authTablePrefix}}members(id),
  created_by TEXT REFERENCES {{kit.authTablePrefix}}members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX {{kit.tablePrefix}}orgs_personal ON {{kit.tablePrefix}}orgs(personal_of) WHERE personal_of IS NOT NULL;

-- Who is in an org, and as what. owner: everything, including deleting the org and changing owners and admins.
-- admin: renames the org, invites people, removes members. member: does the work.
CREATE TABLE {{kit.tablePrefix}}org_members (
  org_id TEXT NOT NULL REFERENCES {{kit.tablePrefix}}orgs(id),
  member_id TEXT NOT NULL REFERENCES {{kit.authTablePrefix}}members(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by TEXT REFERENCES {{kit.authTablePrefix}}members(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, member_id)
);
CREATE INDEX {{kit.tablePrefix}}org_members_member ON {{kit.tablePrefix}}org_members(member_id);

-- An invitation to an email that has no account yet (an existing account is added at once). Accepted the first time
-- that address signs in (the sign-in code proves they own it).
CREATE TABLE {{kit.tablePrefix}}org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES {{kit.tablePrefix}}orgs(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by TEXT NOT NULL REFERENCES {{kit.authTablePrefix}}members(id),
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by TEXT REFERENCES {{kit.authTablePrefix}}members(id),
  revoked_at INTEGER
);
CREATE UNIQUE INDEX {{kit.tablePrefix}}org_invites_open ON {{kit.tablePrefix}}org_invites(org_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX {{kit.tablePrefix}}org_invites_email ON {{kit.tablePrefix}}org_invites(email);

-- The org a person lands in when a request names none (a bare CLI). Kept here, not as a column on the auth block's
-- members table, so this block never alters another block's tables.
CREATE TABLE {{kit.tablePrefix}}org_defaults (
  member_id TEXT PRIMARY KEY REFERENCES {{kit.authTablePrefix}}members(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES {{kit.tablePrefix}}orgs(id)
);
