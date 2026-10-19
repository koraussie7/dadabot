/**
 * proposal.ts — Normalized model output schema.
 *
 * sam-tools returns free-model completions which can optionally include a
 * structured "proposal" payload — a self-contained description of an edit
 * the model wants to make. We parse that into a Proposal before deciding
 * whether to submit it as a ChangeRequest.
 *
 * This module is the SINGLE source of truth for what counts as "an action
 * the AI wants to take". busabase-adapter consumes it, affine-adapter
 * displays it, executor.ts runs it.
 */

export type ProposalKind =
  | "file_edit"
  | "file_create"
  | "file_delete"
  | "shell_command"
  | "package_install"
  | "external_api";

export interface ProposalFileChange {
  path: string;
  operation: "create" | "modify" | "delete";
  content?: string;
  patch?: string;
  /** Line numbers, used for UI annotations */
  lineRange?: [number, number];
  /** Bytes/lines metrics, used by policy */
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ProposalToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface Proposal {
  /** Stable identifier from the model client (idempotency) */
  id: string;
  /** Which agent / model produced this proposal */
  agent: {
    name: string;
    version: string;
    modelProvider: string;
    modelId: string;
  };
  /** Human-readable title for the inbox + canvas */
  title: string;
  /** Why the model wants to do this — used as the ChangeRequest rationale */
  rationale: string;
  /** Confidence in [0, 1]; passed through to busabase policy */
  confidence: number;
  /** Whether the action is reversible (required for autoMerge on medium-risk) */
  reversible: boolean;
  /** Action category — fed into busabase-adapter's policy.categorizeRisk */
  kind: ProposalKind;
  /** Optional pre-computed diff shown in the inbox preview */
  dryRunPreview?: string;
  /** Either a batch of file edits OR a single tool call */
  files: ProposalFileChange[];
  toolCalls: ProposalToolCall[];
  /** Unix ms; used to compare with busabase CR TTL */
  createdAt: number;
}
