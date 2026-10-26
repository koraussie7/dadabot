/**
 * commands.ts — subcommand handlers.
 *
 * Each handler returns an exit code (0 = success, 1 = error). Side effects
 * (file writes, audit logs) are encapsulated inside; handlers never throw
 * — they format errors and return code 1 instead.
 */

import { existsSync } from "node:fs";
import {
  listRequests,
  approveRequest,
  rejectRequest,
  findRequest,
  runProposal,
} from "./pipeline.ts";
import {
  type PersistentState,
  loadInboxFile,
  loadPersistentState,
} from "./store.ts";
import { createSqliteInbox, migrateJsonInbox } from "../../busabase-adapter/src/inbox-sqlite.ts";
import { formatTable, formatJson, type DadabotEnv } from "./env.ts";
import type {
  ChangeRequest,
  ChangeRequestStatus,
} from "../../busabase-adapter/src/index.ts";

const VALID_STATUSES: ChangeRequestStatus[] = [
  "draft",
  "open",
  "approved",
  "rejected",
  "merged",
  "expired",
  "superseded",
];

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListOptions {
  status?: ChangeRequestStatus;
  agent?: string;
  json?: boolean;
  limit?: number;
}

export function cmdList(env: DadabotEnv, opts: ListOptions): number {
  const state = loadPersistentState(env);
  const all = listRequests(state, opts);
  const limit = opts.limit ?? 50;
  const slice = all.slice(0, limit);

  if (opts.json) {
    console.log(formatJson(slice));
    return 0;
  }

  if (slice.length === 0) {
    console.log("Inbox is empty. (Run `dadabot run <proposal.json>` to submit one.)");
    return 0;
  }

  const rows: string[][] = [
    ["FP", "STATUS", "PERM", "CONFIDENCE", "TITLE"],
    ...slice.map((cr) => [
      cr.id.slice(0, 8),
      cr.status,
      cr.policy.permission,
      cr.confidence.toFixed(2),
      cr.title.slice(0, 60),
    ]),
  ];
  console.log(formatTable(rows));
  console.log(`\n${slice.length} of ${all.length} (use --limit N to show more)`);
  return 0;
}

// ---------------------------------------------------------------------------
// approve / reject
// ---------------------------------------------------------------------------

export interface DecisionOptions {
  id: string;
  comment?: string;
  json?: boolean;
}

export function cmdApprove(env: DadabotEnv, opts: DecisionOptions): number {
  return decideInternal(env, opts, "approve");
}

export function cmdReject(env: DadabotEnv, opts: DecisionOptions): number {
  return decideInternal(env, opts, "reject");
}

function decideInternal(
  env: DadabotEnv,
  opts: DecisionOptions,
  action: "approve" | "reject",
): number {
  if (!opts.id) {
    console.error(`error: ${action} requires a ChangeRequest id (or fingerprint)`);
    console.error(`usage: dadabot ${action} <crId> [--comment "..."] [--json]`);
    return 1;
  }
  const state = loadPersistentState(env);
  const cr = findRequest(state, opts.id);
  if (!cr) {
    console.error(`error: ChangeRequest "${opts.id}" not found in inbox`);
    return 1;
  }
  if (cr.status !== "open") {
    console.error(
      `error: ChangeRequest ${opts.id} is ${cr.status}, only "open" can be ${action}d`,
    );
    return 1;
  }

  const comment = opts.comment ?? `${action}d via CLI`;
  const updated = action === "approve"
    ? state.inbox.approve(cr.id, env.actor, comment)
    : state.inbox.reject(cr.id, env.actor, comment);

  if (opts.json) {
    console.log(formatJson(updated));
  } else {
    console.log(`✓ ${action}d ${updated.id.slice(0, 8)}: ${updated.title}`);
    console.log(`  actor: ${env.actor}`);
    console.log(`  comment: ${comment}`);
    console.log(`  audit entries: ${updated.audit.length}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export interface ShowOptions {
  id: string;
  json?: boolean;
}

export function cmdShow(env: DadabotEnv, opts: ShowOptions): number {
  if (!opts.id) {
    console.error("error: show requires a ChangeRequest id (or fingerprint)");
    return 1;
  }
  const state = loadPersistentState(env);
  const cr = findRequest(state, opts.id);
  if (!cr) {
    console.error(`error: ChangeRequest "${opts.id}" not found`);
    return 1;
  }
  if (opts.json) {
    console.log(formatJson(cr));
    return 0;
  }
  console.log(formatShow(cr));
  return 0;
}

function formatShow(cr: ChangeRequest): string {
  const lines: string[] = [];
  lines.push(`# ChangeRequest ${cr.id.slice(0, 8)}`);
  lines.push("");
  lines.push(`Title:        ${cr.title}`);
  lines.push(`Status:       ${cr.status}`);
  lines.push(`Permission:   ${cr.policy.permission}  (${cr.policy.reason})`);
  lines.push(`Confidence:   ${cr.confidence.toFixed(2)}`);
  lines.push(`Reversible:   ${cr.reversible}`);
  lines.push(`Agent:        ${cr.agent.name} v${cr.agent.version}`);
  lines.push(`Model:        ${cr.agent.modelProvider}/${cr.agent.modelId}`);
  lines.push(`Created:      ${cr.createdAt}`);
  lines.push(`Expires:      ${cr.expiresAt}`);
  lines.push("");
  lines.push(`Rationale:`);
  lines.push(`  ${cr.rationale}`);
  if (cr.files.length > 0) {
    lines.push("");
    lines.push(`Files (${cr.files.length}):`);
    for (const f of cr.files) {
      lines.push(`  ${f.operation}  ${f.path}  (+${f.linesAdded}/-${f.linesRemoved})`);
    }
  }
  if (cr.dryRunPreview) {
    lines.push("");
    lines.push(`Dry-run preview:`);
    lines.push(cr.dryRunPreview.split("\n").map((l) => `  ${l}`).join("\n"));
  }
  lines.push("");
  lines.push(`Audit (${cr.audit.length} entries):`);
  for (const e of cr.audit) {
    lines.push(`  ${e.at}  ${e.actor.padEnd(16)}  ${e.action}${e.detail ? `  (${e.detail})` : ""}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export interface RunOptions {
  file: string;
  /** When true, route to inbox.approve() automatically; default: open for review */
  autoApprove?: boolean;
  json?: boolean;
}

export function cmdRun(env: DadabotEnv, opts: RunOptions): number {
  const state = loadPersistentState(env);
  try {
    const result = runProposal(state, env, opts);
    if (opts.json) {
      console.log(formatJson(result));
    } else {
      console.log(`✓ proposal processed`);
      console.log(`  CR: ${result.cr.id}`);
      console.log(`  permission: ${result.cr.policy.permission}`);
      console.log(`  blocks posted: ${result.blockCount}`);
      console.log(`  applied: ${result.applied}`);
    }
    return 0;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// inbox (alias + summary)
// ---------------------------------------------------------------------------

export function cmdInbox(env: DadabotEnv, opts: { json?: boolean }): number {
  const state = loadPersistentState(env);
  const all = state.inbox.list();
  const counts: Record<ChangeRequestStatus, number> = {
    draft: 0,
    open: 0,
    approved: 0,
    rejected: 0,
    merged: 0,
    expired: 0,
    superseded: 0,
  };
  for (const cr of all) counts[cr.status]++;

  const summary = {
    total: all.length,
    pending: counts.open,
    approved: counts.approved,
    rejected: counts.rejected,
    merged: counts.merged,
    expired: counts.expired,
    inboxFile: env.inboxFile,
    workspaceFile: `${env.home}/workspace.json`,
  };

  if (opts.json) {
    console.log(formatJson(summary));
    return 0;
  }
  console.log(`DadaBot Inbox · ${summary.pending} pending review${summary.pending === 1 ? "" : "s"}`);
  console.log(`  total:    ${summary.total}`);
  console.log(`  pending:  ${summary.pending}`);
  console.log(`  approved: ${summary.approved}`);
  console.log(`  rejected: ${summary.rejected}`);
  console.log(`  merged:   ${summary.merged}`);
  console.log(`  expired:  ${summary.expired}`);
  console.log("");
  console.log(`  inbox file:     ${summary.inboxFile}`);
  console.log(`  workspace file: ${summary.workspaceFile}`);
  return 0;
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  json?: boolean;
}

export interface DoctorResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export function cmdDoctor(env: DadabotEnv, opts: DoctorOptions): number {
  const state = loadPersistentState(env);
  const checks: DoctorResult["checks"] = [];

  checks.push({
    name: "DADABOT_HOME exists",
    ok: existsSync(env.home),
    detail: env.home,
  });
  checks.push({
    name: "Inbox readable",
    ok: true,
    detail: `${state.inbox.list().length} ChangeRequest(s)`,
  });
  checks.push({
    name: "Workspace readable",
    ok: true,
    detail: `${state.workspace.listBlocks().length} block(s)`,
  });
  checks.push({
    name: "Node version >= 22",
    ok: parseInt(process.versions.node.split(".")[0] ?? "0", 10) >= 22,
    detail: `Node ${process.versions.node}`,
  });
  checks.push({
    name: "No expired open CRs",
    ok: !state.inbox.list({ status: "open" }).some((cr) => new Date(cr.expiresAt).getTime() <= Date.now()),
    detail: "sweep not required",
  });

  const ok = checks.every((c) => c.ok);
  if (opts.json) {
    console.log(formatJson({ ok, checks }));
  } else {
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(28)} ${c.detail}`);
    }
    console.log("");
    console.log(ok ? "✓ All checks passed" : "✗ One or more checks failed");
  }
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

export function cmdVersion(env: DadabotEnv): number {
  console.log(`dadabot ${env.version} (cli 0.1.0)`);
  console.log(`node:    ${process.versions.node}`);
  console.log(`home:    ${env.home}`);
  console.log(`inbox:   ${env.inboxFile}`);
  return 0;
}

// ---------------------------------------------------------------------------
// migrate-inbox — copy legacy inbox.json into the SQLite backend
// ---------------------------------------------------------------------------
export interface MigrateOptions {
  json?: boolean;
}

/**
 * One-way, idempotent import of ~/.dadabot/inbox.json into ~/.dadabot/inbox.db.
 *
 * The JSON file is left untouched so a rollback is just unsetting
 * DADABOT_INBOX_BACKEND. Re-running imports nothing new because the CR id is
 * the primary key.
 */
export function cmdMigrateInbox(env: DadabotEnv, opts: MigrateOptions = {}): number {
  const legacy = loadInboxFile(env.inboxFile);
  const dbPath = process.env["DADABOT_INBOX_DB"] ?? `${env.home}/inbox.db`;

  if (legacy.length === 0) {
    if (opts.json) {
      console.log(formatJson({ migrated: 0, total: 0, dbPath, note: "legacy inbox empty or missing" }));
    } else {
      console.log(`Nothing to migrate (${env.inboxFile} is empty or missing).`);
    }
    return 0;
  }

  const inbox = createSqliteInbox({ path: dbPath });
  try {
    const imported = migrateJsonInbox(inbox, legacy);
    const total = inbox.size();
    if (opts.json) {
      console.log(formatJson({ migrated: imported, total, dbPath, source: env.inboxFile }));
    } else {
      console.log(`Imported ${imported} new ChangeRequest(s); ${total} total in ${dbPath}.`);
      if (imported === 0) {
        console.log("(Already migrated — nothing to do.)");
      } else {
        console.log("Legacy inbox.json left in place. To use the new backend:");
        console.log("  export DADABOT_INBOX_BACKEND=sqlite");
      }
    }
    return 0;
  } catch (err) {
    console.error(`error: migration failed — ${(err as Error).message}`);
    return 1;
  } finally {
    inbox.close();
  }
}
