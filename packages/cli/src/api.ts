/**
 * The only module that talks to the network: a small client for kit-api's REST routes (PLAN WP-02). Everything goes
 * through the injected `fetch`, so tests run against an in-process mock with no network.
 *
 * Routes (WP-02's docs/API.md):
 *   GET  /api/search?q&runtime&framework&db&ui&tags&scope&limit         → {results: Card[]}
 *   GET  /api/blocks/:scope/:name                                         → {id, versions[{version, status}], tags{latest,…}}
 *   GET  /api/blocks/:scope/:name/:version/(summary|manifest|files|skill|changelog)?variant=
 *   GET  /api/blocks/:scope/:name/:version/bundle?variant=[&allow_yanked=1] → {manifest, files[{path, content_b64}], publisher_key, …}
 *   POST /api/blocks/:scope/:name/versions                                → {id, version, scan{tier, findings[]}, url}
 *   POST /api/proposals                                                   → {proposal_id}
 *   POST /api/projects/:id/heartbeat                                      → {project_id, installs, …}
 *   GET  /api/me                                                          → {member, orgs[], scope_default, plan}
 *   GET  /api/registry/key                                                → {public_key, key_id}
 * `:scope` is the org slug without the `@`. Errors are the contract's `{error: {code, message}}` envelope.
 * The bundle's `registry_key` is never trusted: signatures are checked against the key pinned at `kit login`.
 */
import { KitError, TOOL_ERROR_CODES, parseBlockRef, type CardT, type ToolErrorCode } from "@kitbash/core";
import type { Settings } from "./config.ts";

export interface BundleResponse {
  id: string;
  version: string;
  variant?: string;
  manifest: unknown;
  files: { path: string; content_b64: string; sha256?: string }[] | Record<string, string>;
  publisher_key?: string;
  /** Older name for `publisher_key`. */
  publisher_public_key?: string;
  publisher_signature?: string;
  registry_signature?: string;
}

export interface BlockInfo {
  id: string;
  versions: { version: string; yanked?: boolean }[];
  tags: Record<string, string>;
}

export interface PublishBody {
  manifest: unknown;
  files: { path: string; content_b64: string }[];
  publisher_signature: string;
  publisher_key: string;
  visibility: "private" | "public";
  license?: string;
  tag?: string;
}

export interface PublishResponse {
  id: string;
  version: string;
  scan: { tier: string; findings: { rule: string; path: string; severity: string; detail?: string }[] };
  url: string;
}

export interface ApiClient {
  readonly baseUrl: string;
  search(q: { query: string; stack?: Record<string, string>; tags?: string[]; scope?: string; limit?: number }): Promise<{ results: CardT[] }>;
  block(id: string): Promise<BlockInfo>;
  get(id: string, version: string, detail: string, variant?: string): Promise<Record<string, unknown>>;
  bundle(id: string, version: string, opts?: { variant?: string; allowYanked?: boolean }): Promise<BundleResponse>;
  publish(id: string, body: PublishBody): Promise<PublishResponse>;
  propose(body: Record<string, unknown>): Promise<{ proposal_id: string }>;
  heartbeat(projectId: string, body: Record<string, unknown>): Promise<unknown>;
  me(): Promise<Record<string, unknown>>;
  registryKey(): Promise<string>;
  /** Resolves a ref with an optional version or tag to a concrete version (default tag `latest`). */
  resolveVersion(ref: string, version?: string): Promise<{ id: string; version: string }>;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function blockPath(id: string): string {
  const r = parseBlockRef(id);
  return `/api/blocks/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.name)}`;
}

export function createApi(settings: Pick<Settings, "apiUrl" | "token">, fetchImpl: typeof fetch): ApiClient {
  let base: URL;
  try {
    base = new URL(settings.apiUrl);
  } catch {
    throw new KitError("invalid_params", `bad registry URL ${JSON.stringify(settings.apiUrl)}`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new KitError("invalid_params", "the registry URL must be http(s)");
  const insecure = base.protocol === "http:" && !LOOPBACK.has(base.hostname);

  async function call<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
    const url = new URL(path, base);
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth !== false) {
      if (!settings.token) throw new KitError("unauthorized", "not signed in: run `kit login` or set KIT_TOKEN");
      if (insecure) throw new KitError("forbidden", `refusing to send the token over plain http to ${base.host}; use https`);
      headers.authorization = `Bearer ${settings.token}`;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "error" });
    } catch (e) {
      throw new KitError("internal", `registry unreachable at ${base.origin}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (res.ok) throw new KitError("internal", `registry sent a non-JSON response for ${method} ${url.pathname}`);
      }
    }
    if (!res.ok) {
      const env = (data as { error?: { code?: string; message?: string; retry_after_s?: number } } | undefined)?.error;
      const code: ToolErrorCode =
        env?.code && (TOOL_ERROR_CODES as readonly string[]).includes(env.code)
          ? (env.code as ToolErrorCode)
          : res.status === 401
            ? "unauthorized"
            : res.status === 403
              ? "forbidden"
              : res.status === 404
                ? "not_found"
                : res.status === 409
                  ? "conflicts"
                  : res.status === 429
                    ? "rate_limited"
                    : res.status === 400 || res.status === 422
                      ? "invalid_params"
                      : "internal";
      const msg = env?.message ?? `${method} ${url.pathname} answered ${res.status}`;
      throw new KitError(code, code === "unauthorized" ? `${msg} (run \`kit login\`)` : msg, { details: data });
    }
    return data as T;
  }

  const api: ApiClient = {
    baseUrl: base.origin,
    search: (q) => {
      const p = new URLSearchParams({ q: q.query });
      for (const [k, v] of Object.entries(q.stack ?? {})) if (v) p.set(k, v);
      if (q.tags?.length) p.set("tags", q.tags.join(","));
      if (q.scope) p.set("scope", q.scope);
      if (q.limit) p.set("limit", String(q.limit));
      return call("GET", `/api/search?${p}`);
    },
    block: (id) => call("GET", blockPath(id)),
    get: (id, version, detail, variant) =>
      call("GET", `${blockPath(id)}/${encodeURIComponent(version)}/${encodeURIComponent(detail)}${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`),
    bundle: (id, version, o = {}) => {
      const q = new URLSearchParams();
      if (o.variant) q.set("variant", o.variant);
      if (o.allowYanked) q.set("allow_yanked", "1");
      const qs = q.toString();
      return call("GET", `${blockPath(id)}/${encodeURIComponent(version)}/bundle${qs ? `?${qs}` : ""}`);
    },
    publish: (id, body) => call("POST", `${blockPath(id)}/versions`, body),
    propose: (body) => call("POST", "/api/proposals", body),
    heartbeat: (projectId, body) => call("POST", `/api/projects/${encodeURIComponent(projectId)}/heartbeat`, body),
    me: () => call("GET", "/api/me"),
    registryKey: async () => {
      const r = await call<{ public_key?: string }>("GET", "/api/registry/key", undefined, { auth: false });
      if (!r?.public_key || !/^ed25519:[A-Za-z0-9_-]{43}$/.test(r.public_key)) throw new KitError("signature_invalid", "the registry did not return a valid ed25519 key");
      return r.public_key;
    },
    resolveVersion: async (ref, version) => {
      const r = parseBlockRef(ref);
      if (version) return { id: r.id, version };
      if (r.version) return { id: r.id, version: r.version };
      const info = await api.block(r.id);
      const tag = r.tag ?? "latest";
      const v = info?.tags?.[tag];
      if (!v) throw new KitError("not_found", `${r.id} has no tag ${tag}`);
      return { id: r.id, version: v };
    },
  };
  return api;
}
