/**
 * allowlist.ts — Loads and enforces the operator-authored policy file.
 *
 * Two independent gates are applied before anything runs:
 *   1. STATIC  — the action id must exist in INFRA_ACTION_IDS and the policy
 *                file must grant it. Unknown ids are unrepresentable upstream,
 *                but we re-check so a caller cannot smuggle one in via JSON.
 *   2. RUNTIME — NEVER_AUTOMATIC / APPROVAL_REQUIRED are hardcoded in
 *                types.ts, so editing the JSON cannot widen them.
 *
 * Staleness: the loader fingerprints the policy file's bytes and mtime. If the
 * file changes underneath a running executor, further validations return
 * POLICY_STALE until the caller explicitly reloads. This prevents "edit the
 * JSON to grant yourself rights, then wait for the next tick".
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import {
  APPROVAL_REQUIRED,
  INFRA_ACTION_IDS,
  NEVER_AUTOMATIC,
  RESTARTABLE_SERVICES,
  type ActionPolicy,
  type AllowlistPolicy,
  type InfraAction,
  type InfraActionId,
  type InfraTarget,
  type RestartableService,
  type ValidationResult,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const actionPolicySchema = z
  .object({
    automatic: z.boolean(),
    reversible: z.boolean(),
    maxAttempts: z.number().int().min(0).max(10).optional(),
    cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
    maxLines: z.number().int().min(1).max(10_000).optional(),
    allow: z.array(z.string().min(1)).optional(),
    requireHealthCheck: z.boolean().optional(),
  })
  .strict();

const policySchema = z
  .object({
    version: z.number().int().min(1),
    mode: z.literal("allowlist"),
    targetGroup: z.string().min(1).optional(),
    targets: z.array(z.string().min(1)).optional(),
    actions: z.record(z.string(), actionPolicySchema),
  })
  .strict();

/** Policy loaded from disk, plus the fingerprint used for staleness checks. */
export interface LoadedPolicy {
  policy: AllowlistPolicy;
  sourcePath: string;
  fingerprint: string;
  loadedAt: number;
}

export class PolicyLoadError extends Error {
  readonly code: "PARSE_ERROR" | "SCHEMA_ERROR" | "READ_ERROR" | "UNKNOWN_ACTION";
  constructor(code: PolicyLoadError["code"], message: string) {
    super(message);
    this.name = "PolicyLoadError";
    this.code = code;
  }
}

function fingerprintOf(sourcePath: string): string {
  const st = statSync(sourcePath);
  const hash = createHash("sha256");
  hash.update(readFileSync(sourcePath));
  hash.update(String(st.mtimeMs));
  hash.update(String(st.size));
  return hash.digest("hex");
}

/**
 * Parse policy JSON text. Exposed separately so tests can exercise the
 * schema without touching the filesystem.
 */
export function parsePolicy(text: string, sourcePath = "<inline>"): AllowlistPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new PolicyLoadError("PARSE_ERROR", `${sourcePath}: ${(err as Error).message}`);
  }
  const parsed = policySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PolicyLoadError(
      "SCHEMA_ERROR",
      `${sourcePath}: ${first ? `${first.path.join(".")} — ${first.message}` : "invalid policy"}`,
    );
  }
  // Reject unknown action ids instead of silently ignoring them: a typo like
  // "shell.arbitary: {automatic:true}" must fail loudly.
  const known = new Set<string>(INFRA_ACTION_IDS);
  for (const key of Object.keys(parsed.data.actions)) {
    if (!known.has(key)) {
      throw new PolicyLoadError("UNKNOWN_ACTION", `${sourcePath}: unknown action "${key}"`);
    }
  }
  return parsed.data as AllowlistPolicy;
}

export function loadPolicy(sourcePath: string): LoadedPolicy {
  let text: string;
  try {
    text = readFileSync(sourcePath, "utf8");
  } catch (err) {
    throw new PolicyLoadError("READ_ERROR", `${sourcePath}: ${(err as Error).message}`);
  }
  const policy = parsePolicy(text, sourcePath);
  return {
    policy,
    sourcePath,
    fingerprint: fingerprintOf(sourcePath),
    loadedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
export interface AttemptRecord {
  count: number;
  lastAt: number;
}

export interface ValidateOptions {
  /** Inventory targets the executor is allowed to name. */
  targets: readonly InfraTarget[];
  /** Current time, injectable for cooldown tests. */
  now?: number;
  /** Per-action attempt bookkeeping, keyed by `${actionId}:${target}`. */
  attempts?: Map<string, AttemptRecord>;
  /** Set when the caller has obtained human approval for this action. */
  approved?: boolean;
}

function attemptKey(actionId: InfraActionId, target: string): string {
  return `${actionId}:${target}`;
}

export function getActionPolicy(
  policy: AllowlistPolicy,
  actionId: InfraActionId,
): ActionPolicy | undefined {
  return policy.actions[actionId];
}

/**
 * The single authority for "may this run?".
 * Pure: does not mutate `options.attempts` (the caller records the attempt
 * only once the action actually starts, so refusals never burn budget).
 */
export function validateAction(
  loaded: LoadedPolicy,
  action: InfraAction,
  options: ValidateOptions,
): ValidationResult {
  const { policy } = loaded;

  // -- staleness ------------------------------------------------------------
  let currentFingerprint: string | undefined;
  try {
    currentFingerprint = fingerprintOf(loaded.sourcePath);
  } catch {
    // File vanished: fail closed.
    return { ok: false, code: "POLICY_STALE", reason: "policy file is no longer readable" };
  }
  if (currentFingerprint !== loaded.fingerprint) {
    return {
      ok: false,
      code: "POLICY_STALE",
      reason: "policy file changed since load; reload required before executing",
    };
  }

  // -- action existence -----------------------------------------------------
  if (!(INFRA_ACTION_IDS as readonly string[]).includes(action.id)) {
    return { ok: false, code: "UNKNOWN_ACTION", reason: `unknown action "${action.id}"` };
  }
  const actionPolicy = policy.actions[action.id];
  if (!actionPolicy) {
    return {
      ok: false,
      code: "ACTION_NOT_ALLOWED",
      reason: `action "${action.id}" is not present in the allowlist`,
    };
  }
  if (!actionPolicy.automatic) {
    return {
      ok: false,
      code: "ACTION_DISABLED",
      reason: `action "${action.id}" has automatic=false in the allowlist`,
    };
  }

  // -- hardcoded escalation gates ------------------------------------------
  if (NEVER_AUTOMATIC.has(action.id) && !options.approved) {
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      reason: `action "${action.id}" always requires human approval`,
    };
  }
  if (APPROVAL_REQUIRED.has(action.id) && !options.approved) {
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      reason: `action "${action.id}" requires human approval`,
    };
  }

  // -- target ---------------------------------------------------------------
  const target = options.targets.find((t) => t.name === action.target);
  if (!target) {
    return {
      ok: false,
      code: "TARGET_NOT_ALLOWED",
      reason: `target "${action.target}" is not in the inventory allowlist`,
    };
  }
  if (policy.targetGroup && target.group && policy.targetGroup !== target.group) {
    return {
      ok: false,
      code: "TARGET_NOT_ALLOWED",
      reason: `target "${action.target}" belongs to "${target.group}", policy allows "${policy.targetGroup}"`,
    };
  }
  if (policy.targets && !policy.targets.includes(target.name)) {
    return {
      ok: false,
      code: "TARGET_NOT_ALLOWED",
      reason: `target "${action.target}" is not listed in policy.targets`,
    };
  }

  // -- arguments ------------------------------------------------------------
  if (action.id === "service.restart") {
    if (!action.service) {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        reason: "service.restart requires a service name",
      };
    }
    if (!(RESTARTABLE_SERVICES as readonly string[]).includes(action.service)) {
      return {
        ok: false,
        code: "SERVICE_NOT_ALLOWED",
        reason: `service "${action.service}" is not restartable by this executor`,
      };
    }
    if (actionPolicy.allow && !actionPolicy.allow.includes(action.service)) {
      return {
        ok: false,
        code: "SERVICE_NOT_ALLOWED",
        reason: `policy does not allow restarting "${action.service}"`,
      };
    }
    if (target.allowedServices && !target.allowedServices.includes(action.service as RestartableService)) {
      return {
        ok: false,
        code: "SERVICE_NOT_ALLOWED",
        reason: `target "${target.name}" does not permit restarting "${action.service}"`,
      };
    }
  }

  if (action.id === "read_logs") {
    if (action.lines !== undefined && (!Number.isInteger(action.lines) || action.lines <= 0)) {
      return { ok: false, code: "INVALID_ARGUMENT", reason: "lines must be a positive integer" };
    }
  }

  if (action.id === "http.probe") {
    if (!action.url || !/^https?:\/\//i.test(action.url)) {
      return { ok: false, code: "INVALID_ARGUMENT", reason: "http.probe requires an http(s) URL" };
    }
  }

  // -- budget ---------------------------------------------------------------
  if (options.now !== undefined && options.attempts) {
    const record = options.attempts.get(attemptKey(action.id, action.target));
    if (record) {
      const maxAttempts = actionPolicy.maxAttempts ?? 1;
      if (record.count >= maxAttempts) {
        return {
          ok: false,
          code: "ATTEMPTS_EXHAUSTED",
          reason: `action "${action.id}" already attempted ${record.count}/${maxAttempts} times on "${action.target}"`,
        };
      }
      const cooldownMs = (actionPolicy.cooldownSeconds ?? 0) * 1000;
      if (cooldownMs > 0 && options.now - record.lastAt < cooldownMs) {
        const waitS = Math.ceil((cooldownMs - (options.now - record.lastAt)) / 1000);
        return {
          ok: false,
          code: "COOLDOWN_ACTIVE",
          reason: `cooldown active for "${action.id}" on "${action.target}" (${waitS}s remaining)`,
        };
      }
    }
  }

  return { ok: true, reason: `allowed: ${action.id} on ${action.target}` };
}

/** Record that an action actually started. Call only after a successful validate. */
export function recordAttempt(
  attempts: Map<string, AttemptRecord>,
  action: InfraAction,
  now: number,
): void {
  const key = attemptKey(action.id, action.target);
  const previous = attempts.get(key);
  attempts.set(key, {
    count: (previous?.count ?? 0) + 1,
    lastAt: now,
  });
}

/** Test/ops helper: clear budget for one action+target, or everything. */
export function resetAttempts(
  attempts: Map<string, AttemptRecord>,
  action?: InfraAction,
): void {
  if (!action) {
    attempts.clear();
    return;
  }
  attempts.delete(attemptKey(action.id, action.target));
}
