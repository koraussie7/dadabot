/**
 * types.ts — Shared contracts for the infra executor.
 *
 * Design rules encoded here (see INFRA-AUTOMATION-EXECUTION-PLAN.md §2-3):
 *   1. An action is a LITERAL id, never a shell string. Arbitrary shell is
 *      deliberately not representable.
 *   2. Reversibility is declared per-action by the operator, not by the model.
 *   3. Every execution is bound to a named target from the Ansible inventory.
 */

/** Literal action identifiers. There is no "run anything" member. */
export const INFRA_ACTION_IDS = [
  "health_check",
  "read_logs",
  "nginx.validate",
  "nginx.reload",
  "caddy.validate",
  "service.restart",
  "config.rollback",
  "docker.inspect",
  "http.probe",
  // Traefik — the test instance that fronts tunnel-published services.
  "traefik.validate",
  "traefik.reload",
  // Cloudflare Tunnel — the outbound path for new domains.
  "tunnel.status",
  "tunnel.restart",
] as const;

export type InfraActionId = (typeof INFRA_ACTION_IDS)[number];

/**
 * Services the runner may ever touch. Keep this narrow: it is a second
 * gate behind the action allowlist.
 */
export const RESTARTABLE_SERVICES = ["nginx", "caddy", "charon", "traefik", "cloudflared"] as const;
export type RestartableService = (typeof RESTARTABLE_SERVICES)[number];

/**
 * Actions that are never executed automatically, regardless of how the
 * policy file is edited. Hardcoded so a bad policy edit cannot widen them.
 */
export const NEVER_AUTOMATIC: ReadonlySet<InfraActionId> = new Set<InfraActionId>([
  "config.rollback",
]);

/** Actions that may only run after an explicit human approval. */
export const APPROVAL_REQUIRED: ReadonlySet<InfraActionId> = new Set<InfraActionId>([
  "service.restart",
  "config.rollback",
  "tunnel.restart",
]);

/** An inventory target. Must match a host name in inventory/hosts.ini. */
export interface InfraTarget {
  /** inventory hostname, e.g. "proxy01" */
  name: string;
  /** SSH address — informational; the runner never connects itself. */
  host?: string;
  /** Ansible group, e.g. "proxy_nodes" */
  group?: string;
  /** Optional per-target restrictions on top of the global allowlist. */
  allowedServices?: readonly RestartableService[];
}

/** A concrete, already-validated request to touch one target. */
export interface InfraAction {
  id: InfraActionId;
  target: string;
  /** Service name, required by service.restart only. */
  service?: RestartableService;
  /** For read_logs: how many trailing lines. Clamped by policy. */
  lines?: number;
  /** For http.probe: absolute URL. */
  url?: string;
  /** Free-form correlation id (alert fingerprint, CR id, ...). */
  correlationId?: string;
  /** Human/model-supplied reason. Audit only — never parsed. */
  reason?: string;
}

/** Per-action policy entry as authored by an operator. */
export interface ActionPolicy {
  automatic: boolean;
  reversible: boolean;
  maxAttempts?: number;
  cooldownSeconds?: number;
  maxLines?: number;
  allow?: readonly string[];
  requireHealthCheck?: boolean;
}

export interface AllowlistPolicy {
  version: number;
  mode: "allowlist";
  targetGroup?: string;
  targets?: readonly string[];
  actions: Partial<Record<InfraActionId, ActionPolicy>>;
}

/** Result of the validate stage. */
export interface ValidationResult {
  ok: boolean;
  /** Machine-readable rejection code when ok === false. */
  code?: ValidationCode;
  reason: string;
}

export type ValidationCode =
  | "UNKNOWN_ACTION"
  | "ACTION_NOT_ALLOWED"
  | "ACTION_DISABLED"
  | "TARGET_NOT_ALLOWED"
  | "SERVICE_NOT_ALLOWED"
  | "APPROVAL_REQUIRED"
  | "COOLDOWN_ACTIVE"
  | "ATTEMPTS_EXHAUSTED"
  | "INVALID_ARGUMENT"
  | "POLICY_STALE";

/** Outcome of a single command invocation. */
export interface CommandResult {
  command: string;
  argv: readonly string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Pluggable command runner — injected so tests never spawn processes. */
export interface CommandRunner {
  run(command: string, argv: readonly string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
}

/** A verification step that decides whether the action actually worked. */
export interface Verification {
  ok: boolean;
  detail: string;
}

export interface VerificationCheck {
  name: string;
  check(runner: CommandRunner, action: InfraAction): Promise<Verification>;
}

export type ExecutionStage =
  | "validate"
  | "snapshot"
  | "precheck"
  | "execute"
  | "verify"
  | "rollback"
  | "escalate";

export interface ExecutionEvent {
  stage: ExecutionStage;
  at: number;
  actionId: InfraActionId;
  target: string;
  detail?: string;
  error?: string;
}

export interface ExecutionResult {
  action: InfraAction;
  status: "succeeded" | "rolled_back" | "failed" | "refused";
  stages: ExecutionEvent[];
  /** Populated when status === "refused". */
  refusal?: ValidationResult;
  command?: CommandResult;
  verification?: Verification;
  rollbackApplied?: boolean;
  /** true when retries are exhausted and a human must look. */
  escalate: boolean;
}
