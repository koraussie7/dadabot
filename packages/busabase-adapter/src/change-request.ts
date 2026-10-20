/**
 * change-request.ts — The "Action Proposal" core of busabase-adapter.
 *
 * A ChangeRequest is what an AI agent submits before taking a sensitive
 * action. It carries:
 *   - structured rationale (why)
 *   - confidence score (how sure)
 *   - proposed patch / diff (what)
 *   - reversibility + dry-run preview
 *   - audit trail
 *
 * Mirrors busabase's `ChangeRequest` and `Inbox` schema but adapted
 * to Dadabot's monorepo + GitHub PR workflow.
 */

import {
  decide,
  type Permission,
  type PolicyContext,
  type PolicyDecision,
} from "./policy.ts";

export const ChangeRequestStatuses = [
  "draft",
  "open",
  "approved",
  "rejected",
  "merged",
  "expired",
  "superseded",
] as const;
export type ChangeRequestStatus = typeof ChangeRequestStatuses[number];

export interface ProposedFile {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  content?: string;
  patch?: string;
  previousPath?: string;
  sha256?: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface ChangeRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: ChangeRequestStatus;
  agent: {
    name: string;
    version: string;
    modelProvider: string;
    modelId: string;
  };
  title: string;
  rationale: string;
  category: string;
  confidence: number;
  reversible: boolean;
  files: ProposedFile[];
  dryRunPreview?: string;
  policy: {
    permission: Permission;
    reason: string;
    requiresDryRunPreview: boolean;
  };
  audit: AuditEntry[];
  github?: {
    repo: string;
    number: number;
    url: string;
    headSha: string;
  };
}

export interface CreateChangeRequestInput {
  agent: ChangeRequest["agent"];
  title: string;
  rationale: string;
  category: string;
  confidence: number;
  reversible: boolean;
  files: ProposedFile[];
  policy: PolicyContext;
  dryRunPreview?: string;
  ttlMs?: number;
}

export class PolicyDeniedError extends Error {
  readonly decision: PolicyDecision;
  constructor(decision: PolicyDecision) {
    super(`Policy denied: ${decision.reason}`);
    this.decision = decision;
    this.name = "PolicyDeniedError";
  }
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Create a ChangeRequest. Runs the policy decision; if policy returns
 * `autoMerge` AND caller opted-in via `autoMergeAcknowledged`, the CR
 * is created with status `merged` directly. Otherwise it is `open` and
 * waits for human approval.
 */
export function createChangeRequest(
  input: CreateChangeRequestInput,
  options: { autoMergeAcknowledged?: boolean; now?: () => Date } = {},
): ChangeRequest {
  const now = options.now ?? (() => new Date());
  const decision = decide(input.policy);

  if (decision.permission === "autoMerge" && !options.autoMergeAcknowledged) {
    throw new PolicyDeniedError(decision);
  }

  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const initialStatus: ChangeRequestStatus =
    decision.permission === "autoMerge" ? "merged" : "open";

  return {
    id: crypto.randomUUID(),
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: initialStatus,
    agent: input.agent,
    title: input.title.trim(),
    rationale: input.rationale.trim(),
    category: input.category,
    confidence: input.confidence,
    reversible: input.reversible,
    files: input.files,
    dryRunPreview: input.dryRunPreview,
    policy: {
      permission: decision.permission,
      reason: decision.reason,
      requiresDryRunPreview: decision.requiresDryRunPreview,
    },
    audit: [
      {
        at: createdAt.toISOString(),
        actor: input.agent.name,
        action: "created",
        detail: `confidence=${input.confidence.toFixed(2)}`,
      },
    ],
  };
}

/** Apply a human decision to an existing ChangeRequest */
export function applyDecision(
  cr: ChangeRequest,
  decision: "approve" | "reject",
  actor: string,
  comment: string | undefined,
  now: () => Date = () => new Date(),
): ChangeRequest {
  const updated: ChangeRequest = {
    ...cr,
    updatedAt: now().toISOString(),
    status:
      decision === "approve"
        ? "approved"
        : cr.policy.permission === "autoMerge"
          ? cr.status
          : "rejected",
    audit: [
      ...cr.audit,
      {
        at: now().toISOString(),
        actor,
        action: decision === "approve" ? "approved" : "rejected",
        detail: comment,
      },
    ],
  };
  return updated;
}

export function isExpired(cr: ChangeRequest, now: Date = new Date()): boolean {
  return now.getTime() > new Date(cr.expiresAt).getTime();
}

/** FNV-1a 32-bit deterministic hash (crypto-free, works in Node + browser) */
function fnv1a32(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic short fingerprint for display (crypto-free, works in Node + browser) */
export function fingerprint(cr: ChangeRequest): string {
  const input = `${cr.id}:${cr.title}:${cr.createdAt}`;
  const h1 = fnv1a32(input);
  const h2 = fnv1a32(input + ":v2");
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(4, "0")
  ).slice(0, 12);
}
