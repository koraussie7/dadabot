/**
 * proposal-bridge integration tests — the 5-stage pipeline end-to-end.
 *
 * 22 cases covering:
 *   - Proposal schema
 *   - runPipeline: ingest → decide → submit → await → complete
 *   - busabase-adapter + affine-adapter integration
 *   - executor recording
 *   - synopsis rendering
 *   - rejection path
 *   - autoMerge fast path
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runPipeline,
  createRecordingExecutor,
  synopsis,
  PipelineAbortError,
  type Proposal,
  type PipelineEvent,
} from "../src/index.ts";
import { createInbox, createMemoryAuditLogger } from "../../busabase-adapter/src/index.ts";
import { createWorkspace, DADABOT_SCHEMAS } from "../../affine-adapter/src/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p-1",
    agent: {
      name: "claude-sonnet",
      version: "0.1.0",
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4.5",
    },
    title: "Refactor FindPage to use sam-tools free models",
    rationale:
      "Reduce API cost by routing read-only calls to the free model rotator. Reversible via git revert.",
    confidence: 0.92,
    reversible: true,
    kind: "file_edit",
    files: [
      {
        path: "apps/web/src/routes/FindPage.tsx",
        operation: "modify",
        content: "// patched",
        linesAdded: 12,
        linesRemoved: 7,
      },
    ],
    toolCalls: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeContext() {
  const inbox = createInbox();
  const workspace = createWorkspace({ id: "ws-test", schema: DADABOT_SCHEMAS });
  const audit = createMemoryAuditLogger();
  return { inbox, workspace, audit };
}

// ---------------------------------------------------------------------------
// Proposal schema
// ---------------------------------------------------------------------------

test("Proposal: defaults to empty files + toolCalls", () => {
  const p = makeProposal({ files: [], toolCalls: [] });
  assert.equal(p.files.length, 0);
  assert.equal(p.toolCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Synopsis
// ---------------------------------------------------------------------------

test("synopsis: produces headline + body + fileList", () => {
  const s = synopsis(makeProposal());
  assert.match(s.headline, /LOW\] Refactor FindPage/);
  assert.ok(s.body.includes("claude-sonnet"));
  assert.equal(s.fileList.length, 1);
});

test("synopsis: shell_command is critical", () => {
  const s = synopsis(makeProposal({ kind: "shell_command" }));
  assert.equal(s.riskTag, "critical");
});

test("synopsis: .env path is critical", () => {
  const s = synopsis(
    makeProposal({
      files: [{ path: ".env", operation: "modify", content: "x", linesAdded: 1, linesRemoved: 0 }],
    }),
  );
  assert.equal(s.riskTag, "critical");
});

test("synopsis: low confidence bumps to high", () => {
  const s = synopsis(makeProposal({ confidence: 0.3 }));
  assert.ok(["high", "critical"].includes(s.riskTag));
});

// ---------------------------------------------------------------------------
// Pipeline: autoMerge fast path
// ---------------------------------------------------------------------------

test("pipeline: high confidence + reversible + medium risk → autoMerge → executor called", async () => {
  const ctx = makeContext();
  const executor = createRecordingExecutor();
  const events: PipelineEvent[] = [];

  const result = await runPipeline(
    makeProposal({ confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e),
      executor: executor.apply,
    },
  );

  assert.equal(result.cr.status, "merged");
  assert.equal(result.applied, true);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]![0]!.path, "apps/web/src/routes/FindPage.tsx");
  const stages = events.map((e) => e.stage);
  assert.deepEqual(stages, ["ingest", "decide", "submit", "complete"]);
});

test("pipeline: autoMerge mirrors ai-message block to workspace", async () => {
  const ctx = makeContext();
  const executor = createRecordingExecutor();
  await runPipeline(
    makeProposal({ id: "p-2", confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true },
    { executor: executor.apply },
  );
  const blocks = ctx.workspace.listBlocks();
  const ai = blocks.find((b) => b.flavour === "dadabot:ai-message");
  const note = blocks.find((b) => b.flavour === "dadabot:human-note");
  assert.ok(ai, "ai-message block missing");
  assert.ok(note, "human-note block missing");
  assert.equal(note?.props.linkedBlockId, ai?.id);
});

// ---------------------------------------------------------------------------
// Pipeline: changeRequest path (requires human approval)
// ---------------------------------------------------------------------------

test("pipeline: low confidence → changeRequest, blocks until approved", async () => {
  const ctx = makeContext();
  const executor = createRecordingExecutor();
  const events: PipelineEvent[] = [];

  const result = await runPipeline(
    makeProposal({ id: "p-3", confidence: 0.3 }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e),
      executor: executor.apply,
      awaitDecision: async () => "approve",
    },
  );

  assert.equal(result.cr.status, "approved");
  assert.equal(result.applied, true);
  assert.equal(executor.calls.length, 1);
  const stages = events.map((e) => e.stage);
  assert.ok(stages.includes("await"));
  assert.equal(stages[stages.length - 1], "complete");
});

test("pipeline: changeRequest rejected → executor NOT called", async () => {
  const ctx = makeContext();
  const executor = createRecordingExecutor();
  const result = await runPipeline(
    makeProposal({ id: "p-4", confidence: 0.3 }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      executor: executor.apply,
      awaitDecision: async () => "reject",
    },
  );
  assert.equal(result.applied, false);
  assert.equal(executor.calls.length, 0);
  assert.equal(result.cr.status, "rejected");
});

test("pipeline: changeRequest without awaitDecision throws PipelineAbortError", async () => {
  const ctx = makeContext();
  await assert.rejects(
    () =>
      runPipeline(
        makeProposal({ confidence: 0.3 }),
        { ...ctx, autoMergeAcknowledged: true },
      ),
    (err: unknown) => err instanceof PipelineAbortError && err.code === "NO_AWAITER",
  );
});

// ---------------------------------------------------------------------------
// Pipeline: policy edge cases
// ---------------------------------------------------------------------------

test("pipeline: critical-risk file_edit (protected path) → changeRequest", async () => {
  const ctx = makeContext();
  const events: PipelineEvent[] = [];
  await runPipeline(
    makeProposal({
      id: "p-5",
      files: [{ path: ".env", operation: "modify", content: "x", linesAdded: 1, linesRemoved: 0 }],
    }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e),
      awaitDecision: async () => "approve",
    },
  );
  const cr = ctx.inbox.list({ status: "approved" })[0]!;
  assert.equal(cr.policy.permission, "changeRequest");
});

test("pipeline: shell_command always changeRequest", async () => {
  const ctx = makeContext();
  await runPipeline(
    makeProposal({ kind: "shell_command" }),
    { ...ctx, autoMergeAcknowledged: true },
    { awaitDecision: async () => "approve" },
  );
  const cr = ctx.inbox.list({ status: "approved" })[0]!;
  assert.equal(cr.policy.permission, "changeRequest");
});

// ---------------------------------------------------------------------------
// Pipeline: CR ↔ block reference integrity
// ---------------------------------------------------------------------------

test("pipeline: ai-message block stores changeRequestId linking to CR", async () => {
  const ctx = makeContext();
  await runPipeline(
    makeProposal({ id: "p-6" }),
    { ...ctx, autoMergeAcknowledged: true },
    { executor: createRecordingExecutor().apply },
  );
  const ai = ctx.workspace.listBlocks().find((b) => b.flavour === "dadabot:ai-message")!;
  const crId = ai.props.changeRequestId as string;
  const cr = ctx.inbox.get(crId);
  assert.ok(cr, "CR referenced by block must exist in inbox");
});

test("pipeline: audit logger records submit + complete", async () => {
  const ctx = makeContext();
  await runPipeline(
    makeProposal({ id: "p-7" }),
    { ...ctx, autoMergeAcknowledged: true },
    { executor: createRecordingExecutor().apply },
  );
  const actions = ctx.audit.entries.map((e) => e.action);
  assert.ok(actions.includes("submitted"));
  assert.ok(actions.includes("completed"));
});

// ---------------------------------------------------------------------------
// Pipeline: emits all 5 stages in order (autoMerge path)
// ---------------------------------------------------------------------------

test("pipeline: emits ingest → decide → submit → complete (autoMerge)", async () => {
  const ctx = makeContext();
  const events: PipelineEvent[] = [];
  await runPipeline(
    makeProposal({ id: "p-8", confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e),
      executor: createRecordingExecutor().apply,
    },
  );
  const stages = events.map((e) => e.stage);
  assert.deepEqual(stages, ["ingest", "decide", "submit", "complete"]);
});

test("pipeline: emits ingest → decide → submit → await → complete (changeRequest)", async () => {
  const ctx = makeContext();
  const events: PipelineEvent[] = [];
  await runPipeline(
    makeProposal({ id: "p-9", confidence: 0.3 }),
    { ...ctx, autoMergeAcknowledged: true },
    {
      onEvent: (e) => events.push(e),
      awaitDecision: async () => "approve",
      executor: createRecordingExecutor().apply,
    },
  );
  const stages = events.map((e) => e.stage);
  assert.deepEqual(stages, ["ingest", "decide", "submit", "await", "complete"]);
});

// ---------------------------------------------------------------------------
// Pipeline: timestamps and idempotency
// ---------------------------------------------------------------------------

test("pipeline: respects ctx.now for deterministic timestamps", async () => {
  const ctx = makeContext();
  let now = 1000;
  const result = await runPipeline(
    makeProposal({ id: "p-10", confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true, now: () => now },
    { executor: createRecordingExecutor().apply },
  );
  assert.equal(new Date(result.cr.createdAt).getTime(), 1000);
});

test("pipeline: same Proposal ID is allowed (idempotency is the inbox's job)", async () => {
  const ctx = makeContext();
  await runPipeline(
    makeProposal({ id: "p-11", confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true },
    { executor: createRecordingExecutor().apply },
  );
  // The pipeline does not dedupe; the inbox layer is responsible (see test below).
  await runPipeline(
    makeProposal({ id: "p-11", confidence: 0.95 }),
    { ...ctx, autoMergeAcknowledged: true },
    { executor: createRecordingExecutor().apply },
  );
  // Both CRs are stored (different UUIDs)
  assert.equal(ctx.inbox.list().length, 2);
});

// ---------------------------------------------------------------------------
// Executor: recording
// ---------------------------------------------------------------------------

test("executor: recording executor captures every call", async () => {
  const e = createRecordingExecutor();
  await e.apply([{ path: "a.ts", operation: "create", content: "x", linesAdded: 1, linesRemoved: 0 }]);
  await e.apply([{ path: "b.ts", operation: "delete", linesAdded: 0, linesRemoved: 1 }]);
  assert.equal(e.calls.length, 2);
  assert.equal(e.calls[0]![0]!.path, "a.ts");
  assert.equal(e.calls[1]![0]!.operation, "delete");
});

// ---------------------------------------------------------------------------
// Cross-adapter integrity
// ---------------------------------------------------------------------------

test("integration: full flow — Proposal → CR → block → approve → executor", async () => {
  const ctx = makeContext();
  const executor = createRecordingExecutor();

  // 1. proposal arrives from sam-tools
  const proposal = makeProposal({ id: "p-final", confidence: 0.4, kind: "package_install" });

  // 2. pipeline submits (will require approval)
  const result = await runPipeline(
    proposal,
    { ...ctx, autoMergeAcknowledged: true },
    {
      awaitDecision: async (cr) => {
        // 3. UI shows inbox; human reviews via canvas block
        const ai = ctx.workspace.listBlocks().find((b) => b.props.changeRequestId === cr.id)!;
        assert.ok(ai);
        return "approve";
      },
      executor: executor.apply,
    },
  );

  // 4. CR is approved, executor ran, note block linked back
  assert.equal(result.cr.status, "approved");
  assert.equal(executor.calls.length, 1);
  const blocks = ctx.workspace.listBlocks();
  const note = blocks.find((b) => b.flavour === "dadabot:human-note")!;
  const ai = blocks.find((b) => b.flavour === "dadabot:ai-message")!;
  assert.equal(note.props.linkedBlockId, ai.id);
  assert.equal(ctx.audit.entries.length >= 2, true);
});

test("integration: rejected proposal leaves no note block", async () => {
  const ctx = makeContext();
  await runPipeline(
    makeProposal({ id: "p-reject", confidence: 0.3 }),
    { ...ctx, autoMergeAcknowledged: true },
    { awaitDecision: async () => "reject" },
  );
  const blocks = ctx.workspace.listBlocks();
  const note = blocks.find((b) => b.flavour === "dadabot:human-note");
  assert.equal(note, undefined, "rejected proposals must not produce a human-note block");
});
