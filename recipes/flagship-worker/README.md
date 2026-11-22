# Evaluate a Cloudflare Flagship flag in a Worker

Wrangler binds a Flagship app to the Worker as `env.FLAGS`. The example evaluates the boolean `new-projects` flag with a default of `false`. The app ID in `wrangler.jsonc` is a local fixture.

## Try the binding locally

From this recipe directory, start the Worker with a pinned Wrangler CLI.

```sh
npx --yes wrangler@4.152.0 dev --local --port 8787
```

From a second terminal, run `curl --silent http://127.0.0.1:8787` to read the fallback. Stop the dev server with Ctrl-C before editing its local store. In the recipe directory, create the flag and restart the Worker.

```sh
npx --yes wrangler@4.152.0 flagship flags create 00000000-0000-4000-8000-000000000001 new-projects --type boolean --default on --local
npx --yes wrangler@4.152.0 dev --local --port 8787
```

Run the same curl command again. The first request returns `{"enabled":false}` on an empty store. The second returns `{"enabled":true}`. Both commands use the same default Wrangler state directory. A clean directory makes the example repeatable. Local evaluation needs no Cloudflare login.

## Use an existing app

Set `flagship[].app_id` to your app's ID in each Worker environment that evaluates flags. Run `wrangler types` for a TypeScript Worker. Pass the signed-in member's stable ID as `targetingKey` and derive targeting attributes such as an email domain from the verified session. Pass the same context when enforcing the feature in the server route. The fixture member in the example is for the local exercise.

Wrangler management commands take an explicit app ID. For example, `wrangler flagship flags pull <APP_ID>` copies remote definitions into the local store. Editing remote flags requires the corresponding read and write permissions. The deployed Worker receives its evaluation capability through the binding.

A standalone Node server runs outside the Worker binding environment. Use the Flagship server SDK there. For local SDK evaluation, give that service a private **Flagship App Read** token scoped to the app so it can download definitions. Flagship token policies select apps. Rules inside an app select flag audiences.

[Workers binding API](https://developers.cloudflare.com/flagship/binding/) · [Wrangler commands and local flag store](https://developers.cloudflare.com/flagship/reference/wrangler-commands/) · [App-scoped token permissions](https://developers.cloudflare.com/flagship/api-tokens/)
