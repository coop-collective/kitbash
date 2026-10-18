---
name: kitbash-publish
description: How to publish a finished Kitbash block - choose visibility (private by default, public only after review), license and price, understand what the scanner rejects, sign in, publish, and read the result. Use when the user asks to publish, release, share or version a block, or to make a private block public.
---

# Publish a block

Publishing is outward: it uploads a signed copy of the block to the registry. Do it only when the user asked for it in
this conversation, and say what will be published (name, version, visibility, license, file count) before you call the tool.

## Before you publish

1. The block validates and its tests pass in a clean project (see `kitbash-harvest`, section 4). Bump `version` in
   `block.json` for any change: published versions are immutable (they can be yanked, never edited).
2. **Visibility.** `private` (default) is visible to the owner's org only and findings are warnings. `public` is visible
   to everyone and is **refused on any scan finding**, including warnings. Making a block public is the user's decision:
   ask, do not assume. Never publish public on your own initiative.
3. **License** is an SPDX id (`MIT`, `Apache-2.0`, `UNLICENSED` for private blocks). A block harvested from open-source
   code carries that license and attribution; do not relicense it.
4. **Price.** The CLI does not support paid blocks yet; `registry_publish` refuses a `price` until payments exist.
5. Sign-in: `kit login` (a token from the web UI or `pnpm kit:token`), or `KIT_TOKEN` in the environment. Never ask the
   user to paste a token into the chat, and never write one into a file in the project.

## What the scanner rejects

- Secrets: known prefixes (`hq_`, `xk_live_`, `mc_`, `sk_live_`, `AKIA`), JWTs, private keys, high-entropy strings.
- Path problems: files declared but not shipped or shipped but not declared, `..`, symlinks, executable bits.
- Dangerous code: `eval`, `new Function`, `child_process`, URL imports, `fetch` to hosts not declared in
  `meta.network_hosts`, long base64 or hex blobs, minified files.
- Prompt injection in any text field or doc: imperatives aimed at agents ("ignore previous"), URLs to fetch, commands to
  run, HTML comments, invisible Unicode, ANSI escapes.
- Manifest inconsistency: declared tables, routes or env that do not appear in the files; missing tests;
  `verify.commands` outside the allowlist; a summary over about 1,500 tokens (split the block or shorten it).
- Dependencies: advisories, typosquats, and names that do not exist on npm.

## Publish

`registry_publish {block_dir, visibility, license?, tag?}` (`visibility` is required: pass `private` unless the user
chose `public`). The reply has `id`, `version`, the scan `tier` and `findings[]`, and the URL. Read the findings out to
the user; fix and bump the version rather than arguing with the scanner. The tier starts at `unreviewed`/`scanned` and rises
with verified use; it cannot be bought.

After a private publish, `registry_search` should find the block in the owner's scope; mention how to install it
(`kitbash-use`). A public publish is a separate, explicit step.
