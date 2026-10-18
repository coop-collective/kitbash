// Bindings, the authenticated caller, and the API error type.
import { KitError, type ToolErrorCode } from "@kitbash/core";

export interface Bindings {
  DB: D1Database;
  BLOBS: R2Bucket;
  SCAN: Queue<{ version_id: string }>;
  ENVIRONMENT: string;
  /** HMAC pepper for kit_ token hashes (secret). */
  TOKEN_PEPPER?: string;
  /** The registry's Ed25519 private key as a JWK JSON string (secret). */
  REGISTRY_SIGNING_KEY?: string;
}

export interface OrgRef {
  id: string;
  slug: string;
  name: string;
  plan: string;
  role: "owner" | "admin" | "member";
}

export interface Caller {
  member: { id: string; email: string; name: string | null };
  orgs: OrgRef[];
  /** The member's default org (falls back to the first membership). Null for a member without any org. */
  defaultOrg: OrgRef | null;
  tokenId: string;
}

export type AppEnv = { Bindings: Bindings; Variables: { caller: Caller } };

/** HTTP status for each contract error code. */
export const STATUS: Record<ToolErrorCode, number> = {
  needs_local: 400,
  not_found: 404,
  invalid_params: 400,
  unauthorized: 401,
  forbidden: 403,
  version_yanked: 410,
  conflicts: 409,
  plan_stale: 409,
  signature_invalid: 422,
  scan_refused: 422,
  verify_not_allowed: 400,
  rate_limited: 429,
  internal: 500,
};

export interface ApiFinding {
  rule: string;
  path: string;
  severity: "info" | "warn" | "block";
  detail?: string;
}

/** An error that becomes the contract envelope `{error: {code, message, findings?, ...}}`. */
export class ApiError extends Error {
  readonly code: ToolErrorCode;
  readonly status: number;
  readonly findings: ApiFinding[] | undefined;
  readonly extra: Record<string, unknown>;
  constructor(code: ToolErrorCode, message: string, opts: { status?: number; findings?: ApiFinding[]; rule?: string; extra?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.status = opts.status ?? STATUS[code];
    this.findings = opts.findings ?? (opts.rule ? [{ rule: opts.rule, path: "", severity: "block", detail: message }] : undefined);
    this.extra = opts.extra ?? {};
  }
}

/** The envelope and status for any thrown value (KitError from core keeps its code). */
export function toEnvelope(e: unknown): { status: number; body: { error: Record<string, unknown> } } {
  if (e instanceof ApiError) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.findings ? { findings: e.findings } : {}), ...e.extra } } };
  }
  if (e instanceof KitError) {
    const findings = e.rule ? [{ rule: e.rule, path: "", severity: "block" as const, detail: e.message }] : undefined;
    return { status: STATUS[e.code], body: { error: { code: e.code, message: e.message, ...(findings ? { findings } : {}) } } };
  }
  console.error(JSON.stringify({ msg: "unhandled error", error: String(e), stack: (e as Error)?.stack }));
  return { status: 500, body: { error: { code: "internal", message: "internal error; the registry logged it" } } };
}
