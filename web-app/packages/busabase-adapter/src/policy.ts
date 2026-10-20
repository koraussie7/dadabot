/**
 * policy.ts — Permission gating for Change Requests.
 *
 * Implements a 3-tier escalation model adapted from busabase's Inbox:
 *   read         — observable, never modifies
 *   changeRequest— proposes, waits for human approval
 *   autoMerge    — acts immediately (audited only)
 *
 * Decision matrix:
 *   confidence × risk × category  →  permission tier
 */

export type Permission = "read" | "changeRequest" | "autoMerge";

export type ActionCategory =
  | "file_edit"
  | "file_delete"
  | "git_push"
  | "network_call"
  | "shell_command"
  | "package_install"
  | "secret_access"
  | "external_api"
  | "database_write";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PolicyContext {
  /** Model's self-reported confidence [0, 1] */
  confidence: number;
  /** Category of the proposed action */
  category: ActionCategory;
  /** Whether the action is reversible */
  reversible: boolean;
  /** Whether the action touches a known protected path */
  touchesProtected: boolean;
  /** Whether the user has opted into higher autonomy */
  autonomyLevel: 0 | 1 | 2 | 3;
}

export interface PolicyDecision {
  permission: Permission;
  reason: string;
  requiresDryRunPreview: boolean;
  maxWaitMs: number;
}

const CATEGORY_BASE_RISK: Record<ActionCategory, RiskLevel> = {
  file_edit: "medium",
  file_delete: "high",
  git_push: "high",
  network_call: "medium",
  shell_command: "critical",
  package_install: "high",
  secret_access: "critical",
  external_api: "medium",
  database_write: "high",
};

export function categorizeRisk(ctx: PolicyContext): RiskLevel {
  let level = CATEGORY_BASE_RISK[ctx.category];
  if (!ctx.reversible && level === "medium") level = "high";
  if (ctx.touchesProtected) level = "critical";
  return level;
}

export function decide(ctx: PolicyContext): PolicyDecision {
  const risk = categorizeRisk(ctx);
  const userBoost = ctx.autonomyLevel * 0.1;
  const effectiveConfidence = ctx.confidence + userBoost;

  // Critical-risk actions always require explicit approval
  if (risk === "critical") {
    return {
      permission: "changeRequest",
      reason: `Critical-risk action (${ctx.category}); human approval mandatory`,
      requiresDryRunPreview: true,
      maxWaitMs: 24 * 60 * 60 * 1000,
    };
  }

  // High-risk + low confidence → require approval
  if (risk === "high" && effectiveConfidence < 0.85) {
    return {
      permission: "changeRequest",
      reason: `High-risk (${ctx.category}) with confidence ${ctx.confidence.toFixed(2)}`,
      requiresDryRunPreview: true,
      maxWaitMs: 4 * 60 * 60 * 1000,
    };
  }

  // Medium-risk + low confidence → propose
  if (risk === "medium" && effectiveConfidence < 0.7) {
    return {
      permission: "changeRequest",
      reason: `Medium-risk ${ctx.category} below confidence threshold`,
      requiresDryRunPreview: false,
      maxWaitMs: 60 * 60 * 1000,
    };
  }

  // Medium-risk + decent confidence + reversible → autoMerge (audited)
  if (risk === "medium" && effectiveConfidence >= 0.7) {
    return {
      permission: "autoMerge",
      reason: `Medium-risk ${ctx.category} (reversible=${ctx.reversible}) with effective confidence ${effectiveConfidence.toFixed(2)}`,
      requiresDryRunPreview: false,
      maxWaitMs: 0,
    };
  }

  // Low-risk + decent confidence → autoMerge (still audited)
  if (risk === "low" && effectiveConfidence >= 0.6) {
    return {
      permission: "autoMerge",
      reason: `Low-risk ${ctx.category}, confidence ${ctx.confidence.toFixed(2)} sufficient`,
      requiresDryRunPreview: false,
      maxWaitMs: 0,
    };
  }

  // Default: propose
  return {
    permission: "changeRequest",
    reason: "Default policy: human approval",
    requiresDryRunPreview: false,
    maxWaitMs: 2 * 60 * 60 * 1000,
  };
}

/**
 * Sanitizes shell command arguments to prevent injection.
 * Only allows alphanumeric, dash, underscore, dot, slash, colon, at-sign.
 */
export function sanitizeShellArg(arg: string): string {
  return arg.replace(/[^a-zA-Z0-9_\-.\/:@]/g, "");
}

/** Known protected paths that always escalate to critical */
export const PROTECTED_PATH_PATTERNS = [
  /\.env(\.|$)/,
  /\/secrets?\//,
  /id_rsa|id_ed25519|\.pem$/,
  /\/etc\/(?:passwd|shadow|sudoers)/,
  /\.ssh\//,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /\.(?:gitconfig|netrc)$/,
];

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((re) => re.test(path));
}
