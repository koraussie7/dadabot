/**
 * pipeline.ts — The 5-stage Dadabot safety pipeline.
 *
 *   Stage 1. ingest       — accept a Proposal from sam-tools
 *   Stage 2. decide       — busabase.policy.decide() (read/changeRequest/autoMerge)
 *   Stage 3. submit       — busabase.createChangeRequest(); mirror to affine-adapter
 *   Stage 4. await        — wait for inbox.approve() / inbox.reject()
 *   Stage 5. complete     — apply approved action; publish a human-note block
 *
 * Each stage emits structured events the web console can subscribe to via
 * the EventTarget pattern.
 */

import {
  createChangeRequest,
  type ChangeRequest,
  type Inbox,
  type PolicyDecision,
  type ProposedFile,
  type AuditLogger,
  type Permission,
  type ActionCategory,
} from "../../busabase-adapter/src/index.ts";
import {
  createBlock,
  AIMessageSchema,
  HumanNoteSchema,
  type Workspace,
} from "../../affine-adapter/src/index.ts";
import type { Proposal, ProposalFileChange } from "./proposal.ts";

export type PipelineStage =
  | "ingest"
  | "decide"
  | "submit"
  | "await"
  | "complete"
  | "error";

export interface PipelineEvent {
  proposalId: string;
  stage: PipelineStage;
  at: number;
  detail?: string;
  /** Set when stage === "complete" */
  result?: { permission: Permission; applied: boolean };
  /** Set when stage === "error" */
  error?: { message: string; code?: string };
}

export interface PipelineContext {
  inbox: Inbox;
  workspace: Workspace;
  audit: AuditLogger;
  now?: () => number;
  /** Override autoMerge behaviour per-call */
  autoMergeAcknowledged?: boolean;
}

export interface PipelineResult {
  proposalId: string;
  cr: ChangeRequest;
  decision: PolicyDecision;
  /** Did the pipeline actually execute the proposal? */
  applied: boolean;
}

export class PipelineAbortError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineAbortError";
    this.code = code;
  }
}

function filesToProposed(files: ProposalFileChange[]): ProposedFile[] {
  return files.map((f) => ({
    path: f.path,
    operation: f.operation,
    content: f.content,
    patch: f.patch,
    linesAdded: f.linesAdded ?? 0,
    linesRemoved: f.linesRemoved ?? 0,
  }));
}

function touchesProtected(files: ProposalFileChange[]): boolean {
  // Defer to busabase's matcher by checking the file path
  return files.some((f) =>
    /(?:^|\/)(?:\.env(?:\.|$)|secrets?\/|id_rsa|id_ed25519|\.pem$|\.ssh\/|package-lock\.json$|pnpm-lock\.yaml$|\.gitconfig$|\.netrc$)/i.test(f.path),
  );
}

/**
 * Run a Proposal through the full pipeline. Returns once the CR has either
 * been auto-merged (if policy permitted) or approved by a human.
 *
 * If the policy decision is `changeRequest`, this function blocks until the
 * inbox receives an approve/reject. In the web console the UI drives the
 * inbox; in tests we approve inline before invoking.
 */
export async function runPipeline(
  proposal: Proposal,
  ctx: PipelineContext,
  options: {
    onEvent?: (ev: PipelineEvent) => void;
    /** For changeRequest: callback that resolves on decision (used in tests) */
    awaitDecision?: (cr: ChangeRequest) => Promise<"approve" | "reject">;
    /** Maps file edits → side effects; if omitted, the pipeline records intent only */
    executor?: (files: ProposalFileChange[]) => Promise<unknown>;
  } = {},
): Promise<PipelineResult> {
  const emit = (stage: PipelineStage, detail?: string, extras: Partial<PipelineEvent> = {}): void => {
    options.onEvent?.({
      proposalId: proposal.id,
      stage,
      at: (ctx.now ?? Date.now)(),
      detail,
      ...extras,
    });
  };

  emit("ingest", `${proposal.files.length} file(s), ${proposal.toolCalls.length} tool call(s)`);

  // Stage 2: decide
  const policy = {
    confidence: proposal.confidence,
    category: mapKindToCategory(proposal.kind),
    reversible: proposal.reversible,
    touchesProtected: touchesProtected(proposal.files),
    autonomyLevel: (proposal.agent.name ? 1 : 0) as 0 | 1 | 2 | 3,
  };
  emit("decide", `category=${policy.category}, confidence=${proposal.confidence.toFixed(2)}`);

  // Stage 3: submit
  let cr: ChangeRequest;
  try {
    cr = createChangeRequest(
      {
        agent: proposal.agent,
        title: proposal.title,
        rationale: proposal.rationale,
        category: proposal.kind,
        confidence: proposal.confidence,
        reversible: proposal.reversible,
        files: filesToProposed(proposal.files),
        policy,
        dryRunPreview: proposal.dryRunPreview,
      },
      { autoMergeAcknowledged: ctx.autoMergeAcknowledged, now: () => new Date(ctx.now?.() ?? Date.now()) },
    );
  } catch (err) {
    emit("error", undefined, { error: { message: (err as Error).message, code: "POLICY_DENIED" } });
    throw err;
  }
  ctx.inbox.add(cr);
  await ctx.audit.logChangeRequest(cr, "submitted", proposal.agent.name);
  emit("submit", `cr=${cr.id.slice(0, 8)} permission=${cr.policy.permission}`);

  // Mirror as ai-message block (canvas)
  postAiMessage(proposal, ctx.workspace, cr);

  let applied = false;
  let permission: Permission = cr.policy.permission;

  // Stage 4: await (only if changeRequest)
  if (cr.policy.permission === "changeRequest") {
    emit("await", "waiting for human review");
    if (!options.awaitDecision) {
      // Web console: caller wires up this callback via the Inbox.approve path
      throw new PipelineAbortError(
        "NO_AWAITER",
        "changeRequest permission requires awaitDecision (call inbox.approve() in another flow)",
      );
    }
    const decision = await options.awaitDecision(cr);
    if (decision === "approve") {
      ctx.inbox.approve(cr.id, "human", "approved via canvas");
      if (options.executor) await options.executor(proposal.files);
      applied = true;
    } else {
      ctx.inbox.reject(cr.id, "human", "rejected via canvas");
      emit("complete", "rejected by human", { result: { permission, applied: false } });
      return { proposalId: proposal.id, cr, decision: { permission: "changeRequest", reason: cr.policy.reason, requiresDryRunPreview: cr.policy.requiresDryRunPreview, maxWaitMs: 0 }, applied: false };
    }
    permission = "changeRequest";
  } else {
    // autoMerge — execute immediately
    if (options.executor) await options.executor(proposal.files);
    applied = true;
  }

  // Stage 5: complete
  await ctx.audit.logChangeRequest(cr, "completed", proposal.agent.name);
  if (applied) {
    postHumanNote(proposal, ctx.workspace, cr);
  }
  emit("complete", applied ? "applied" : "approved (executor not provided)", {
    result: { permission, applied },
  });

  return {
    proposalId: proposal.id,
    cr,
    decision: {
      permission: cr.policy.permission,
      reason: cr.policy.reason,
      requiresDryRunPreview: cr.policy.requiresDryRunPreview,
      maxWaitMs: 0,
    },
    applied,
  };
}

function mapKindToCategory(kind: Proposal["kind"]): ActionCategory {
  switch (kind) {
    case "file_edit":
    case "file_create":
    case "file_delete":
      return "file_edit";
    case "shell_command":
      return "shell_command";
    case "package_install":
      return "package_install";
    case "external_api":
      return "external_api";
  }
}

function postAiMessage(
  proposal: Proposal,
  ws: Workspace,
  cr: ChangeRequest,
): void {
  const block = createBlock(AIMessageSchema, {
    id: `ai-${cr.id.slice(0, 8)}`,
    props: {
      role: "assistant",
      content: proposal.rationale,
      modelProvider: proposal.agent.modelProvider,
      modelId: proposal.agent.modelId,
      confidence: proposal.confidence,
      toolCalls: proposal.toolCalls,
      changeRequestId: cr.id,
    },
  });
  ws.addBlock(block);
}

function postHumanNote(
  proposal: Proposal,
  ws: Workspace,
  cr: ChangeRequest,
): void {
  const note = createBlock(HumanNoteSchema, {
    id: `note-${cr.id.slice(0, 8)}`,
    props: {
      author: proposal.agent.name,
      content: `Applied: ${proposal.title}`,
      color: "green",
      linkedBlockId: `ai-${cr.id.slice(0, 8)}`,
    },
  });
  ws.addBlock(note);
}
