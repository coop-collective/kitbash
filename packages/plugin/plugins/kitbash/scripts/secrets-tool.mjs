import { z } from "zod";

const operations = ["setup", "status", "presence", "generate", "provision-github", "provision-github-app", "provision-worker-sync"];
const targets = ["local", "staging", "production"];
const alias = /^[a-z][a-z0-9-]{0,62}$/;
const secretName = /^[A-Z][A-Z0-9_]{0,127}$/;
const errors = {
  invalid_request: "Invalid secrets request. Use an allowed operation, project alias, target, and registered name.",
  forbidden: "The broker principal is not allowed to perform this operation for this project and target.",
  provider_failed: "The provider operation was not confirmed. Check broker audit status before retrying a write.",
  conflict: "The broker found conflicting state. Reconcile it through the trusted operator before retrying.",
  unavailable: "The secrets broker is unavailable or returned an invalid response. Secret and provider details were omitted.",
};

export class BrokerError extends Error {
  constructor(code) {
    const safe = Object.hasOwn(errors, code) ? code : "unavailable";
    super(errors[safe]);
    this.code = safe;
  }
}

export const SECRETS_TOOL = {
  name: "kitbash_secrets",
  description: "Set up registered application secrets and GitHub Actions OIDC / Worker sync access through an operator-configured broker, or check status/presence. provision-github-app starts a new GitHub App manifest handoff; give its approvalUrl to the human to open in their own browser. Accepts aliases and names only; never returns secret values. Setup, provisioning and generation mutate external services. This local client requires KIT_SECRETS_BROKER_URL and a scoped KIT_SECRETS_BROKER_TOKEN in the plugin environment; remote agents can connect directly to the broker's /mcp endpoint.",
  input: z.strictObject({
    operation: z.enum(operations),
    project: z.string().regex(alias),
    target: z.enum(targets),
    name: z.string().regex(secretName).optional(),
  }).superRefine((value, ctx) => {
    if (["generate", "presence"].includes(value.operation) !== (value.name !== undefined)) {
      ctx.addIssue({ code: "custom", message: "name is required only for generate and presence" });
    }
  }),
  // Source generation is create-only, but native sync can replace a same-name Worker binding.
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

function endpoint(env) {
  let url;
  try { url = new URL(env.KIT_SECRETS_BROKER_URL); } catch { throw new BrokerError("unavailable"); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  const dev = env.KIT_SECRETS_BROKER_ALLOW_LOOPBACK_HTTP === "1" && loopback && url.protocol === "http:";
  if ((!dev && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new BrokerError("unavailable");
  }
  const token = env.KIT_SECRETS_BROKER_TOKEN;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new BrokerError("unavailable");
  return { url: new URL("/v1/operations", url), token };
}

// Read a bounded JSON response. Nothing from a provider body, URL, or exception is used as error text.
async function responseJson(response) {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new BrokerError("unavailable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 64 * 1024) throw new BrokerError("unavailable");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reconstruct metadata instead of forwarding any broker object, including successful responses. */
export function secretMetadata(value, request, brokerOrigin) {
  const reject = () => { throw new BrokerError("unavailable"); };
  if (!object(value) || ["operation", "project", "target"].some((key) => value[key] !== request[key])) reject();
  const result = { operation: request.operation, project: request.project, target: request.target };
  if (request.operation === "presence") {
    if (!["present", "missing"].includes(value.status) || value.name !== request.name) reject();
    return { ...result, status: value.status, name: request.name };
  }
  if (request.operation === "generate") {
    if (!["created", "already-exists"].includes(value.status) || value.name !== request.name) reject();
    return { ...result, status: value.status, name: request.name };
  }
  const provisioning = ["provision-github", "provision-worker-sync"].includes(request.operation);
  const app = request.operation === "provision-github-app";
  const statuses = provisioning || app ? ["configured", "pending"] : request.operation === "setup" ? ["ready", "pending"] : ["ready"];
  if (!statuses.includes(value.status)) reject();
  result.status = value.status;
  if (!provisioning) {
    if (!Array.isArray(value.secrets) || value.secrets.length > 256) reject();
    const names = new Set();
    result.secrets = value.secrets.map((secret) => {
      if (!object(secret) || typeof secret.name !== "string" || !secretName.test(secret.name) ||
          !["present", "missing"].includes(secret.status) || names.has(secret.name)) reject();
      names.add(secret.name);
      return { name: secret.name, status: secret.status };
    });
  }
  if (app && value.approvalUrl !== undefined) {
    let url;
    try { url = new URL(value.approvalUrl); } catch { reject(); }
    if (value.status !== "pending" || url.origin !== brokerOrigin || url.username || url.password || url.search || url.hash ||
        !new RegExp(`^/github-app/(?:${request.project}/${request.target}/)?start/[A-Za-z0-9_-]{43}$`).test(url.pathname)) reject();
    result.approvalUrl = url.href;
  }
  for (const [field, operation] of [["github", "provision-github"], ["workerSync", "provision-worker-sync"]]) {
    if (!["status", "setup", operation].includes(request.operation)) continue;
    const connection = value[field];
    if (connection === undefined && !provisioning) continue;
    if (!object(connection) || typeof connection.configured !== "boolean") reject();
    if (provisioning && (value.status === "configured") !== connection.configured) reject();
    result[field] = { configured: connection.configured };
  }
  return result;
}

export async function runSecrets(args, { env = process.env, fetch: request = globalThis.fetch } = {}) {
  const parsed = SECRETS_TOOL.input.safeParse(args);
  if (!parsed.success) throw new BrokerError("invalid_request");
  try {
    const { url, token } = endpoint(env);
    const response = await request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(parsed.data), redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (response.redirected) throw new BrokerError("unavailable");
    const body = await responseJson(response);
    if (!response.ok) throw new BrokerError(body?.error?.code);
    return secretMetadata(body, parsed.data, url.origin);
  } catch (error) {
    if (error instanceof BrokerError) throw error;
    throw new BrokerError("unavailable");
  }
}
