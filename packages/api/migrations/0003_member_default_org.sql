-- kit-api's own column on email-code-auth's members table (0002_auth.sql): the org a member's calls act in by default.
ALTER TABLE members ADD COLUMN default_org_id TEXT REFERENCES orgs(id);
