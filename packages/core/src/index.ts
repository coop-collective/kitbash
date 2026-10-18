/**
 * @kitbash/core: block schema, renderer, planner, lock, hashing/signing, client scanner, harvest heuristics and the
 * `registry_*` contract. No I/O except through an injected `KitFs` (see `@kitbash/core/node` for Node).
 */
export * from "./errors.ts";
export * from "./paths.ts";
export * from "./hash.ts";
export * from "./ref.ts";
export * from "./fs.ts";
export * from "./verify.ts";
export * from "./secrets.ts";
export * from "./injection.ts";
export * from "./render.ts";
export * from "./schema.ts";
export * from "./summary.ts";
export * from "./scan.ts";
export * from "./sign.ts";
export * from "./profile.ts";
export * from "./config-merge.ts";
export * from "./diff.ts";
export * from "./lock.ts";
export {
  planInstall,
  applyPlan,
  readProjectForPlan,
  savePlan,
  loadPlan,
  toContractPlan,
  renderInstalled,
  resolveVariant,
  inferParams,
  renumberMigrations,
  wranglerBindings,
  type PlanInput,
  type InstallPlan,
  type PlannedFile,
  type OnConflict,
  type ApplyOptions,
  type VariantChoice,
} from "./plan.ts";
export * from "./upgrade.ts";
export * from "./harvest.ts";
export * as contract from "./contract.ts";
export {
  UNTRUSTED_NOTICE,
  REGISTRY_TOOLS,
  errorEnvelope,
  type CardT,
  type SummaryT,
  type PlanT,
  type AppliedPlanT,
  type LockEntryT,
  type ConflictT,
  type WriteT,
  type UntrustedAuthorTextT,
  type ErrorEnvelopeT,
  type ToolDef,
} from "./contract.ts";
