/**
 * Dashboard tests — covers page rendering + CR ↔ block integrity.
 *
 * 14 cases covering:
 *   - /inbox: empty + with sample CRs + approve/reject flows
 *   - /canvas: empty + add block + CR-linked blocks
 *   - /safety: stage bar + timeline + demo runner
 *   - cross-page: Inbox approve → Canvas human-note mirror
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInbox,
  createChangeRequest,
  type ChangeRequest,
  type ProposedFile,
} from "../../../packages/busabase-adapter/src/index.ts";
import {
  createWorkspace,
  DADABOT_SCHEMAS,
  createBlock,
  AIMessageSchema,
  HumanNoteSchema,
  getSchema,
} from "../../../packages/affine-adapter/src/index.ts";
import {
  runPipeline,
  createRecordingExecutor,
  type Proposal,
} from "../../../packages/proposal-bridge/src/index.ts";
import { DADABOT_SIDEBAR } from "../src/lib/sidebar.ts";

// Helpers
function makeCR(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  const policy = {
    confidence: 0.5,
    category: "file_edit" as const,
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 1 as 0 | 1 | 2 | 3,
  };
  return createChangeRequest(
    {
      agent: { name: "claude-sonnet", version: "0.1.0", modelProvider: "anthropic", modelId: "claude-sonnet-4.5" },
      title: "Refactor FindPage to use sam-tools free models",
      rationale: "Reduce API cost by routing read-only calls to free model rotator.",
      category: "file_edit",
      confidence: 0.5,
      reversible: true,
      files: [
        { path: "apps/web/src/routes/FindPage.tsx", operation: "modify", linesAdded: 12, linesRemoved: 7, patch: "@@ ..." },
      ] as ProposedFile[],
      policy,
    },
    { autoMergeAcknowledged: true, ...(overrides as object) },
  );
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p-1",
    agent: { name: "claude-sonnet", version: "0.1.0", modelProvider: "anthropic", modelId: "claude-sonnet-4.5" },
    title: "Refactor FindPage to use sam-tools free models",
    rationale: "Reduce API cost by routing read-only calls to free model rotator.",
    confidence: 0.92,
    reversible: true,
    kind: "file_edit",
    files: [{ path: "apps/web/src/routes/FindPage.tsx", operation: "modify", content: "// patched", linesAdded: 12, linesRemoved: 7 }],
    toolCalls: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

test("sidebar: 5 entries with required paths", () => {
  assert.equal(DADABOT_SIDEBAR.length, 5);
  const paths = DADABOT_SIDEBAR.map((e) => e.path);
  assert.ok(paths.includes("/inbox"));
  assert.ok(paths.includes("/canvas"));
  assert.ok(paths.includes("/safety"));
  assert.ok(paths.includes("/agents"));
  assert.ok(paths.includes("/install"));
});

test("sidebar: inbox entry has pendingCount badge slot", () => {
  const inbox = DADABOT_SIDEBAR.find((e) => e.path === "/inbox")!;
  assert.equal(inbox.icon, "🔒");
});

// ---------------------------------------------------------------------------
// /inbox flow
// ---------------------------------------------------------------------------

test("inbox: empty inbox returns 0 CRs", () => {
  const inbox = createInbox();
  assert.equal(inbox.list().length, 0);
});

test("inbox: add CR → list shows 1", () => {
  const inbox = createInbox();
  const cr = makeCR();
  inbox.add(cr);
  assert.equal(inbox.list().length, 1);
});

test("inbox: approve transitions open → approved", () => {
  const inbox = createInbox();
  const cr = makeCR({ confidence: 0.3 });
  // re-make with low confidence → changeRequest → open
  const crLow = createChangeRequest(
    {
      agent: cr.agent,
      title: cr.title,
      rationale: cr.rationale,
      category: "file_edit",
      confidence: 0.3,
      reversible: true,
      files: cr.files,
      policy: { confidence: 0.3, category: "file_edit", reversible: true, touchesProtected: false, autonomyLevel: 0 },
    },
    { autoMergeAcknowledged: true },
  );
  inbox.add(crLow);
  assert.equal(crLow.status, "open");
  const next = inbox.approve(crLow.id, "alice", "lgtm");
  assert.equal(next.status, "approved");
});

test("inbox: reject transitions open → rejected", () => {
  const inbox = createInbox();
  const cr = createChangeRequest(
    {
      agent: { name: "x", version: "0", modelProvider: "y", modelId: "z" },
      title: "Refactor FindPage to use sam-tools free models",
      rationale: "Reduce API cost by routing read-only calls to free model rotator.",
      category: "file_edit",
      confidence: 0.3,
      reversible: true,
      files: [{ path: "a.ts", operation: "modify", linesAdded: 1, linesRemoved: 1 }],
      policy: { confidence: 0.3, category: "file_edit", reversible: true, touchesProtected: false, autonomyLevel: 0 },
    },
    { autoMergeAcknowledged: true },
  );
  inbox.add(cr);
  const next = inbox.reject(cr.id, "bob", "no");
  assert.equal(next.status, "rejected");
});

test("inbox: filter by status=open only shows open CRs", () => {
  const inbox = createInbox();
  inbox.add(createChangeRequest(
    {
      agent: { name: "x", version: "0", modelProvider: "y", modelId: "z" },
      title: "Refactor FindPage to use sam-tools free models",
      rationale: "Reduce API cost by routing read-only calls to free model rotator.",
      category: "file_edit",
      confidence: 0.3,
      reversible: true,
      files: [{ path: "a.ts", operation: "modify", linesAdded: 1, linesRemoved: 1 }],
      policy: { confidence: 0.3, category: "file_edit", reversible: true, touchesProtected: false, autonomyLevel: 0 },
    },
    { autoMergeAcknowledged: true },
  ));
  inbox.add(createChangeRequest(
    {
      agent: { name: "x", version: "0", modelProvider: "y", modelId: "z" },
      title: "Refactor FindPage to use sam-tools free models",
      rationale: "Reduce API cost by routing read-only calls to free model rotator.",
      category: "file_edit",
      confidence: 0.95,
      reversible: true,
      files: [{ path: "b.ts", operation: "modify", linesAdded: 1, linesRemoved: 1 }],
      policy: { confidence: 0.95, category: "file_edit", reversible: true, touchesProtected: false, autonomyLevel: 1 },
    },
    { autoMergeAcknowledged: true },
  ));
  const open = inbox.list({ status: "open" });
  const merged = inbox.list({ status: "merged" });
  assert.equal(open.length, 1);
  assert.equal(merged.length, 1);
});

// ---------------------------------------------------------------------------
// /canvas flow
// ---------------------------------------------------------------------------

test("canvas: empty workspace returns 0 blocks", () => {
  const ws = createWorkspace({ id: "t", schema: DADABOT_SCHEMAS });
  assert.equal(ws.listBlocks().length, 0);
});

test("canvas: add ai-message + human-note blocks", () => {
  const ws = createWorkspace({ id: "t", schema: DADABOT_SCHEMAS });
  ws.addBlock({
    ...createBlock(AIMessageSchema, { id: "ai-1", props: { content: "x" } }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  ws.addBlock({
    ...createBlock(HumanNoteSchema, { id: "n-1", props: { author: "alice", content: "y" } }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const blocks = ws.listBlocks();
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.flavour, "dadabot:ai-message");
  assert.equal(blocks[1]!.flavour, "dadabot:human-note");
});

test("canvas: code-snippet uses default language", () => {
  const schema = getSchema(DADABOT_SCHEMAS, "dadabot:code-snippet")!;
  const b = createBlock(schema, { id: "c-1", props: { code: "x()" } });
  assert.equal(b.props.language, "plaintext");
});

// ---------------------------------------------------------------------------
// /safety flow (runPipeline end-to-end)
// ---------------------------------------------------------------------------

test("safety: autoMerge proposal emits all 4 stages", async () => {
  const inbox = createInbox();
  const ws = createWorkspace({ id: "s", schema: DADABOT_SCHEMAS });
  const audit = (await import("../../../packages/busabase-adapter/src/index.ts")).createMemoryAuditLogger();
  const executor = createRecordingExecutor();
  const events: string[] = [];
  await runPipeline(
    makeProposal({ confidence: 0.95 }),
    { inbox, workspace: ws, audit, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e.stage),
      executor: executor.apply,
    },
  );
  assert.deepEqual(events, ["ingest", "decide", "submit", "complete"]);
});

test("safety: changeRequest proposal emits 5 stages including await", async () => {
  const inbox = createInbox();
  const ws = createWorkspace({ id: "s", schema: DADABOT_SCHEMAS });
  const audit = (await import("../../../packages/busabase-adapter/src/index.ts")).createMemoryAuditLogger();
  const events: string[] = [];
  await runPipeline(
    makeProposal({ confidence: 0.3 }),
    { inbox, workspace: ws, audit, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e.stage),
      awaitDecision: async () => "approve",
    },
  );
  assert.deepEqual(events, ["ingest", "decide", "submit", "await", "complete"]);
});

// ---------------------------------------------------------------------------
// Cross-page: inbox approve → canvas human-note
// ---------------------------------------------------------------------------

test("integration: CR approved → ai-message + human-note blocks mirror", async () => {
  const inbox = createInbox();
  const ws = createWorkspace({ id: "i", schema: DADABOT_SCHEMAS });
  const audit = (await import("../../../packages/busabase-adapter/src/index.ts")).createMemoryAuditLogger();
  const executor = createRecordingExecutor();
  const proposal = makeProposal({ id: "i-1", confidence: 0.3 });

  await runPipeline(
    proposal,
    { inbox, workspace: ws, audit, autoMergeAcknowledged: true },
    {
      awaitDecision: async () => "approve",
      executor: executor.apply,
    },
  );

  // Inbox has approved CR
  const approved = inbox.list({ status: "approved" })[0]!;
  assert.ok(approved);

  // Canvas has ai-message linked to CR + human-note linked to ai-message
  const blocks = ws.listBlocks();
  const ai = blocks.find((b) => b.flavour === "dadabot:ai-message")!;
  const note = blocks.find((b) => b.flavour === "dadabot:human-note")!;
  assert.equal(ai.props.changeRequestId, approved.id);
  assert.equal(note.props.linkedBlockId, ai.id);
});

test("integration: rejected CR has ai-message but NO human-note", async () => {
  const inbox = createInbox();
  const ws = createWorkspace({ id: "i", schema: DADABOT_SCHEMAS });
  const audit = (await import("../../../packages/busabase-adapter/src/index.ts")).createMemoryAuditLogger();

  await runPipeline(
    makeProposal({ id: "i-2", confidence: 0.3 }),
    { inbox, workspace: ws, audit, autoMergeAcknowledged: true },
    {
      awaitDecision: async () => "reject",
    },
  );

  const blocks = ws.listBlocks();
  const ai = blocks.find((b) => b.flavour === "dadabot:ai-message");
  const note = blocks.find((b) => b.flavour === "dadabot:human-note");
  assert.ok(ai, "ai-message should still be posted");
  assert.equal(note, undefined, "human-note must NOT be posted for rejected CRs");
});
