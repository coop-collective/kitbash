/**
 * Error codes and the error class used across core. Two families:
 *
 * - `ToolErrorCode`: the codes of the contract's Error envelope (what an MCP tool or the CLI returns to an agent).
 * - `Finding`: validation/scan findings (`rule` is a stable machine string, `severity` is the contract's
 *   `block | warn | info`). A `block` finding fails validation; `warn` fails only a public publish.
 */

export const TOOL_ERROR_CODES = [
  "needs_local",
  "not_found",
  "invalid_params",
  "unauthorized",
  "forbidden",
  "version_yanked",
  "conflicts",
  "plan_stale",
  "signature_invalid",
  "scan_refused",
  "verify_not_allowed",
  "rate_limited",
  "internal",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export type Severity = "block" | "warn" | "info";

export interface Finding {
  /** Stable rule id, e.g. `path_traversal`, `undeclared_file`, `verify_not_allowlisted`, `secret`. */
  rule: string;
  severity: Severity;
  /** Block-relative file path, or `block.json#/json/pointer` for manifest fields. */
  path: string;
  line?: number;
  detail: string;
}

export class KitError extends Error {
  readonly code: ToolErrorCode;
  readonly rule: string | undefined;
  readonly details: unknown;
  constructor(code: ToolErrorCode, message: string, opts: { rule?: string; details?: unknown } = {}) {
    super(message);
    this.name = "KitError";
    this.code = code;
    this.rule = opts.rule;
    this.details = opts.details;
  }
}

/** Thrown by the renderer and param validation (an `invalid_params` with a specific rule). */
export class RenderError extends KitError {
  constructor(message: string, rule = "render_error", details?: unknown) {
    super("invalid_params", message, { rule, details });
    this.name = "RenderError";
  }
}

export function finding(rule: string, severity: Severity, path: string, detail: string, line?: number): Finding {
  return line === undefined ? { rule, severity, path, detail } : { rule, severity, path, line, detail };
}

export function hasBlocking(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "block");
}
