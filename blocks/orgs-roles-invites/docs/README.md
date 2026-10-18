# orgs-roles-invites

Workspaces for apps that more than one person uses: every account gets a personal workspace, anyone can create a team
org and invite people by email, and every request acts in exactly one org.

## Roles

| | owner | admin | member |
|---|---|---|---|
| see the org's people | yes | yes | yes |
| see open invitations | yes | yes | no |
| rename the org, invite members, remove members | yes | yes | no |
| invite owners, change who is an owner or admin, remove admins | yes | no | no |
| delete a team org (when it holds no data) | yes | no | no |

A personal workspace has exactly one member, its owner; it can't be shared, left or deleted.

## Invitations

`POST /api/orgs/:id/invites {email, role}`. An existing account is added at once; any other address gets a pending
invitation, accepted the first time a member with that address makes a request (email-code-auth only creates members
whose address a code proved). Each org may invite `invitesPerDay` people (default 30) per 24 hours, because each
invite can send a mail from your domain.

## Scoping your data

```ts
app.use("/notes/*", requireBearer, requireOrg);
app.get("/notes", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM notes WHERE org_id = ?").bind(orgOf(c.env)).all();
  return c.json({ notes: results });
});
```

`orgOf(env)` throws when env was never scoped: a cron job or queue consumer scopes per record with
`inOrg(env, row.org_id)`. `orgKey(env, key)` prefixes R2/KV keys with `orgs/<id>/`.

## Origin

Harvested from Ideator (`packages/api/src/orgs.ts`), where orgs hold projects, tasks and agents.
