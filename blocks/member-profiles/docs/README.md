# Member profiles

The block separates editable presentation data from identity and authorization. The host's verified account id selects the row. Profile edits cannot update email, role or another owner.

```ts
app.route("/profiles", profileRoutes(async (request, bindings: Env) => {
  const session = await readSession(bindings, request);
  return session?.owner_id ?? null;
}));
```

`readSession` above is the host authenticator (or session-cookie block), not an automatic dependency. The resolver must also enforce account suspension if the host supports it.

GET `/profiles/me` returns `{ profile, revision }`; missing profiles use `null` and revision `0`. PUT the full fields `handle`, `display_name`, `bio`, `avatar_id`, `is_public`, and `revision` to `/profiles/me`. Handles normalize to lowercase and allow 3–32 ASCII letters/digits/underscores with an initial letter. Display names use at most 80 UTF-16 code units, bios 500; control characters are rejected. Text remains plain text and must be rendered escaped. Avatar ids reference host-served local assets; no remote URL is fetched or emitted by the block.

An SQL unique constraint arbitrates handle claims, while conditional writes reject stale revisions. Clients reload on 409 instead of blindly retrying over another tab's edit. The public endpoint is opt-in and returns only presentation fields. It avoids caching so privacy changes do not leave a stale shared response.

The block includes no profile UI, avatars, moderation, reserved handle policy, rate limits, account identity or deletion hook. Those are host integration tasks. Strict Origin is required even if the resolver accepts a bearer token; non-browser callers can supply that header as part of the same-origin API contract.
