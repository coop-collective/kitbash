// OAuth 2.1 for a person's own CLI, on @cloudflare/workers-oauth-provider: the provider serves the protected resource
// metadata (RFC 9728), the authorization server metadata (RFC 8414), dynamic client registration (RFC 7591), Client
// ID Metadata Documents, PKCE (S256) and the token endpoint, and checks every access token on the API route. This
// file owns the routing around it:
//   * a bearer with the app's own token prefix (a pasted or minted token) never touches the provider;
//   * the API route ({{kit.apiRoute}}) with an OAuth access token: the sign-in row must still be live (checked in D1 on
//     every call, so a revoke is immediate), then the request goes to the app with env.OAUTH_CALLER set;
//   * everything else goes through the provider, and what is not OAuth falls through to the app.
// Served by the provider itself: POST /oauth/register, POST /oauth/token, GET /.well-known/oauth-authorization-server,
// GET /.well-known/oauth-protected-resource{{kit.apiRoute}}.
import { OAuthError, OAuthProvider, getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { cliMember, getCliLogin } from "./cli-logins";
import type { CliProps, OAuthCaller, OAuthEnv } from "./types";

export const TOKEN_PREFIX = "{{kit.tokenPrefix}}";
export const API_ROUTE = "{{kit.apiRoute}}";
export const SCOPES = ["mcp", "offline_access"];

type Fetch = (req: Request, env: OAuthEnv, ctx: ExecutionContext) => Response | Promise<Response>;
/** Serves the API route for an OAuth caller. The default hands the request to the app with env.OAUTH_CALLER set. */
export type ApiHandler = (req: Request, env: OAuthEnv, ctx: ExecutionContext, caller: OAuthCaller) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppLike = { fetch: (req: Request, env: any, ctx: any) => Response | Promise<Response> };

/** The origin OAuth tokens are bound to: PUBLIC_ORIGIN, else the request's own (https, or http on a loopback host). */
export function oauthOrigin(env: OAuthEnv, url: string): string | null {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/+$/, "");
  const u = new URL(url);
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u.origin;
  return null;
}

export function bearerOf(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]! : null;
}

const isCli = (p: unknown): p is CliProps => (p as CliProps | undefined)?.kind === "cli";

function invalidToken(origin: string, why: string): Response {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: why }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer realm="OAuth", error="invalid_token", error_description="${why}", resource_metadata="${origin}/.well-known/oauth-protected-resource${API_ROUTE}"`,
    },
  });
}

function providerOptions(origin: string, app: Fetch, api: ApiHandler): OAuthProviderOptions<OAuthEnv> {
  return {
    apiRoute: API_ROUTE,
    apiHandler: {
      fetch: async (req, env, ctx) => {
        const props = (ctx as ExecutionContext & { props?: unknown }).props;
        const who = isCli(props) ? await cliMember(env, props) : null;
        if (!who) return invalidToken(origin, "this CLI sign-in was revoked; sign in again");
        return api(req, env, ctx, who);
      },
    },
    defaultHandler: { fetch: (req, env, ctx) => app(req as Request, env, ctx) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: SCOPES,
    requiredScopes: ["mcp"],
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: {{kit.accessTokenTtlS}},
    resourceMetadata: { resource: `${origin}${API_ROUTE}`, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "{{kit.brandName}}" },
    // a revoked sign-in can never refresh: invalid_grant also deletes the grant
    tokenExchangeCallback: async ({ props, env }) => {
      const login = isCli(props) ? await getCliLogin(env, props.cli_id) : null;
      if (!login || login.revoked_at) throw new OAuthError("invalid_grant", { description: "this CLI sign-in was revoked; sign in again" });
    },
    onError: ({ code, status, internal }) => {
      if (status >= 500 || internal?.category === "client-registration") console.warn(JSON.stringify({ msg: "oauth error", code, status, category: internal?.category, reason: internal?.reason }));
    },
  };
}

const notFound: Fetch = () => new Response(null, { status: 404 });

/** The provider's helpers outside a provider-routed request (revoking grants from a REST route). */
export function oauthApi(env: OAuthEnv, origin: string) {
  return getOAuthApi(providerOptions(origin, notFound, notFound), env);
}

/** Delete every OAuth grant (and its tokens) of a CLI sign-in. A grant's userId is the sign-in's id. */
export async function revokeCliGrants(env: OAuthEnv, origin: string | null, loginId: string): Promise<number> {
  if (!origin) return 0;
  const api = oauthApi(env, origin);
  let n = 0;
  let cursor: string | undefined;
  do {
    const pageOf = await api.listUserGrants(loginId, cursor ? { cursor } : undefined);
    for (const g of pageOf.items) {
      await api.revokeGrant(g.id, loginId);
      n++;
    }
    cursor = pageOf.cursor;
  } while (cursor);
  return n;
}

/**
 * Wrap the app as the Worker's default export: `export default oauthWorker(app)`. Requests with the app's own bearer
 * prefix go straight to the app; the rest go through the OAuth provider when this origin can carry OAuth.
 */
export function oauthWorker(app: AppLike, opts: { api?: ApiHandler } = {}) {
  const appFetch: Fetch = (req, env, ctx) => app.fetch(req, env, ctx);
  const api: ApiHandler = opts.api ?? ((req, env, ctx, caller) => app.fetch(req, { ...env, OAUTH_CALLER: caller }, ctx));
  const providers = new Map<string, OAuthProvider<OAuthEnv>>();
  return {
    fetch(req: Request, env: OAuthEnv, ctx: ExecutionContext): Response | Promise<Response> {
      if (bearerOf(req)?.startsWith(TOKEN_PREFIX)) return appFetch(req, env, ctx);
      const origin = oauthOrigin(env, req.url);
      if (!origin) return appFetch(req, env, ctx);
      let p = providers.get(origin);
      if (!p) providers.set(origin, (p = new OAuthProvider<OAuthEnv>(providerOptions(origin, appFetch, api))));
      return p.fetch(req, env, ctx);
    },
  };
}
