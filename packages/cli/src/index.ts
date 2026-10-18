/** Programmatic entry (for the plugin's MCP server and the e2e harness). */
export { run, helpText, COMMAND_NAMES } from "./cli.ts";
export { createApi, type ApiClient, type BundleResponse } from "./api.ts";
export type { Io } from "./io.ts";
export { sanitize, untrusted, UNTRUSTED_BEGIN, UNTRUSTED_END } from "./io.ts";
export { execRunner, runVerifyCommands, scrubbedEnv, type Runner } from "./verify.ts";
export { fetchRegistryBlock, loadLocalBlock, isLocalSpec } from "./source.ts";
