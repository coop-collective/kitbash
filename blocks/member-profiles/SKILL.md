---
name: member-profiles
description: Private-by-default profiles with unique handles, safe field projection and revision checks.
---

Adds member_profiles in D1, profile services and profileRoutes(resolveOwner). The resolver receives the Request and typed host bindings, returning the verified owner id or null. It is the sole ownership authority; request body owner ids and role fields are rejected.

Mount at routePrefix. GET /me returns a profile and revision (null and zero before creation). PUT /me replaces handle, display_name, bio, avatar_id, is_public and revision. An exact same-origin Origin and application/json content type are required. Reads and writes use private, no-store responses. The JSON reader counts actual stream bytes and stops above 8192, regardless of Content-Length.

Use the returned revision on the next save. A 409 means a stale edit or unavailable handle; reload and let the person reconcile. SQL uniqueness handles concurrent claims, and revision comparison happens inside the write. There is no read-check-write race.

GET /public/:handle exposes only handle, display_name, bio and avatar_id when the owner explicitly opts in. There are no email, permission, billing or authentication fields in the profile table. Local avatar ids are bounded by avatarCount; null means initials. The host supplies the avatar assets and escapes profile text in UI rendering.

Adapt identity resolution, profile settings, account deletion cleanup, rate limits and any reserved/moderated handle policy. Authentication providers, uploaded avatars, social graph, UI and asset generation remain outside this block. Tests travel with the code and use real D1 migrations, concurrent stale writes, duplicate handles, private/public projection and route authorization.
