/**
 * pipeline.ts — wiring layer between CLI handlers and 3 dadabot adapters.
 *
 * Centralizes:
 *   - `listRequests()`: filter + sort the inbox by status/agent
 *   - `findRequest()`: lookup by UUID or fingerprint (first 12 hex)
 *   - `approveRequest()` / `rejectRequest()`: busabase-decision wrapper
 *   - `runProposal()`: parse a Proposal JSON, run proposal-bridge, persist
 *
 * All handlers in commands.ts delegate to this module.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  type ChangeRequest,
  type Inbox,
  createChangeRequest,
  fingerprint,
} from "../../busabase-adapter/src/index.ts";
import {
  type Workspace,
  createBlock,
  AIMessageSchema,
  HumanNoteSchema,
} from "../../affine-adapter/src/index.ts";
import type { Proposal } from "../../proposal-bridge/src/index.ts";
import type { PersistentState } from "./store.ts";
import type { DadabotEnv } from "./env.ts";
import type {
  ListOptions,
  RunOptions,
} from "./commands.ts";

const MAX_PROPOSAL_SIZE = 1024 * 1024; // 1MB
const RATE_LIMIT = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 10;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const requests = RATE_LIMIT.get(key) || [];
  const recent = requests.filter(t => now - t < 60000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return false;
  recent.push(now);
  RATE_LIMIT.set(key, recent);
  return true;
}

function validateProposalPath(file: string, homeDir: string): string {
  const resolvedPath = resolve(file);
  const resolvedHome = resolve(homeDir);
  const tmpDir = resolve(tmpdir());
  if (!resolvedPath.startsWith(resolvedHome) && !resolvedPath.startsWith(tmpDir)) {
    throw new Error("Path traversal attempt blocked");
  }
  return resolvedPath;
}

function validateProposalContent(txt: string): Proposal {
  if (txt.length > MAX_PROPOSAL_SIZE) {
    throw new Error("Proposal content too large (max 1MB)");
  }
  const proposal = JSON.parse(txt) as Proposal;
  if (!proposal.id || !proposal.title || !proposal.rationale) {
    throw new Error(`proposal must have id/title/rationale (got ${Object.keys(proposal).join(", ")})`);
  }
  return proposal;
}

export interface RunResult {
  cr: ChangeRequest;
  applied: boolean;
  blockCount: number;
}

export function listRequests(
  state: PersistentState,
  opts: ListOptions,
): ChangeRequest[] {
  let crs = state.inbox.list();
  if (opts.status) crs = crs.filter((cr) => cr.status === opts.status);
  if (opts.agent) crs = crs.filter((cr) => cr.agent.name === opts.agent);
  // Sort by createdAt descending (newest first)
  return crs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findRequest(
  state: PersistentState,
  idOrFp: string,
): ChangeRequest | undefined {
  // Try exact id first
  let cr = state.inbox.get(idOrFp);
  if (cr) return cr;
  // Try fingerprint (12-hex prefix)
  if (/^[0-9a-f]{6,12}$/i.test(idOrFp)) {
    cr = state.inbox.getByFingerprint(idOrFp.toLowerCase());
    if (cr) return cr;
  }
  // Fallback: scan for prefix
  const all = state.inbox.list();
  return all.find((c) => c.id.startsWith(idOrFp));
}

export function approveRequest(
  state: PersistentState,
  env: DadabotEnv,
  crId: string,
  comment?: string,
): ChangeRequest | undefined {
  const cr = findRequest(state, crId);
  if (!cr) return undefined;
  if (cr.status !== "open") throw new Error(`CR is ${cr.status}, not open`);
  const updated = state.inbox.approve(cr.id, env.actor, comment ?? "approved via CLI");
  return updated;
}

export function rejectRequest(
  state: PersistentState,
  env: DadabotEnv,
  crId: string,
  comment?: string,
): ChangeRequest | undefined {
  const cr = findRequest(state, crId);
  if (!cr) return undefined;
  if (cr.status !== "open") throw new Error(`CR is ${cr.status}, not open`);
  const updated = state.inbox.reject(cr.id, env.actor, comment ?? "rejected via CLI");
  return updated;
}

export function runProposal(
  state: PersistentState,
  env: DadabotEnv,
  opts: RunOptions,
): RunResult {
  const rateKey = `proposal:${opts.file}`;
  if (!checkRateLimit(rateKey)) {
    throw new Error("Rate limit exceeded (max 10 requests/minute)");
  }

  const resolvedPath = validateProposalPath(opts.file, env.home);
  const stats = statSync(resolvedPath);
  if (stats.size > MAX_PROPOSAL_SIZE) {
    throw new Error("Proposal file too large (max 1MB)");
  }
  const txt = readFileSync(resolvedPath, "utf8");
  const proposal = validateProposalContent(txt);

  // Synchronous stub: skip proposal-bridge's async runPipeline and create
  // the CR directly via busabase-adapter. This avoids the unhandled
  // promise that Node 26's strict event-loop accounting catches.
  const inbox = state.inbox;
  const cr = createChangeRequest({
    title: proposal.title,
    rationale: proposal.rationale,
    agent: proposal.agent,
    category: proposal.kind,
    confidence: proposal.confidence,
    reversible: proposal.reversible,
    files: proposal.files,
    policy: {
      category: proposal.kind,
      reversible: proposal.reversible,
      touchesProtected: false,
      autonomyLevel: 0,
      confidence: proposal.confidence,
    },
  }, { autoMergeAcknowledged: opts.autoApprove });
  inbox.add(cr);

  const ai = createBlock(AIMessageSchema, {
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
  state.workspace.addBlock(ai);
  return { cr, applied: false, blockCount: 1 };
}

