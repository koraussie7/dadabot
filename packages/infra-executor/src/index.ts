/**
 * @agentmesh/infra-executor — public entry point.
 *
 * The execution half of Dadabot's infra safety pipeline. The decision half
 * (confidence → permission tier, inbox, audit) already lives in
 * `@agentmesh/busabase-adapter`; this package only answers:
 *
 *   "given an approved action, is it *allowed*, and did it actually work?"
 *
 *   validate → snapshot → precheck → execute → verify → rollback → escalate
 *
 * See INFRA-AUTOMATION-EXECUTION-PLAN.md §2-3.
 */
export * from "./types.ts";
export * from "./allowlist.ts";
export * from "./runner.ts";
export * from "./probes.ts";
export * from "./rollback.ts";
