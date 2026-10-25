/**
 * busabase-adapter test suite — 24 cases covering policy, change-request,
 * inbox, octokit draft generation, audit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeRisk,
  decide,
  isProtectedPath,
  PROTECTED_PATH_PATTERNS,
  createChangeRequest,
  PolicyDeniedError,
  applyDecision,
  fingerprint,
  isExpired,
  createInbox,
  buildPrDraft,
  createMemoryAuditLogger,
  type ChangeRequest,
  type PolicyContext,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("policy: shell_command requires changeRequest unless reversible at autonomy 3", () => {
  const ctxIrreversible: PolicyContext = {
    confidence: 0.99,
    category: "shell_command",
    reversible: false,
    touchesProtected: false,
    autonomyLevel: 3,
  };
  const d1 = decide(ctxIrreversible);
  assert.equal(d1.permission, "changeRequest");

  const ctxReversible: PolicyContext = {
    confidence: 0.99,
    category: "shell_command",
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 3,
  };
  const d2 = decide(ctxReversible);
  assert.equal(d2.permission, "autoMerge");
});

test("policy: secret_access is critical", () => {
  const d = decide({
    confidence: 0.99,
    category: "secret_access",
    reversible: false,
    touchesProtected: false,
    autonomyLevel: 3,
  });
  assert.equal(d.permission, "changeRequest");
});

test("policy: file_edit + medium confidence + reversible => changeRequest", () => {
  const d = decide({
    confidence: 0.5,
    category: "file_edit",
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 0,
  });
  assert.equal(d.permission, "changeRequest");
});

test("policy: file_edit + high confidence => autoMerge", () => {
  const d = decide({
    confidence: 0.95,
    category: "file_edit",
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 1,
  });
  assert.equal(d.permission, "autoMerge");
});

test("policy: low-risk network_call at autonomy 3 => autoMerge", () => {
  const d = decide({
    confidence: 0.7,
    category: "network_call",
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 3,
  });
  assert.equal(d.permission, "autoMerge");
});

test("policy: protected path forces critical", () => {
  const d = decide({
    confidence: 0.99,
    category: "file_edit",
    reversible: true,
    touchesProtected: true,
    autonomyLevel: 3,
  });
  assert.equal(d.permission, "changeRequest");
});

test("categorizeRisk: irreversible file_edit escalates to high", () => {
  assert.equal(
    categorizeRisk({
      confidence: 0.9,
      category: "file_edit",
      reversible: false,
      touchesProtected: false,
      autonomyLevel: 0,
    }),
    "high",
  );
});

test("categorizeRisk: protected path escalates to critical", () => {
  assert.equal(
    categorizeRisk({
      confidence: 0.9,
      category: "file_edit",
      reversible: true,
      touchesProtected: true,
      autonomyLevel: 0,
    }),
    "critical",
  );
});

test("isProtectedPath: .env, secrets/, id_rsa, /etc/passwd, package-lock", () => {
  for (const p of [".env", ".env.local", "secrets/key.pem", "id_rsa", "/etc/passwd", "package-lock.json", "pnpm-lock.yaml", "~/.netrc"]) {
    assert.ok(isProtectedPath(p), `should flag ${p}`);
  }
});

test("isProtectedPath: README.md is not protected", () => {
  assert.equal(isProtectedPath("README.md"), false);
});

// ---------------------------------------------------------------------------
// Change Request
// ---------------------------------------------------------------------------

const baseInput = {
  agent: { name: "claude-4", version: "0.1.0", modelProvider: "anthropic", modelId: "claude-sonnet-4.5" },
  title: "Refactor FindPage to use sam-tools free models",
  rationale: "Reduce API cost by routing read-only calls to the free model rotator. Reversible via git.",
  category: "file_edit",
  confidence: 0.92,
  reversible: true,
  files: [
    { path: "apps/web/src/routes/FindPage.tsx", operation: "modify" as const, linesAdded: 12, linesRemoved: 7, patch: "@@ ..." },
  ],
  policy: {
    confidence: 0.92,
    category: "file_edit" as const,
    reversible: true,
    touchesProtected: false,
    autonomyLevel: 1,
  },
};

test("createChangeRequest: autoMerge returns status=merged when acknowledged", () => {
  const cr = createChangeRequest(baseInput, { autoMergeAcknowledged: true });
  assert.equal(cr.status, "merged");
  assert.equal(cr.policy.permission, "autoMerge");
});

test("createChangeRequest: changeRequest returns status=open", () => {
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  assert.equal(cr.status, "open");
  assert.equal(cr.policy.permission, "changeRequest");
});

test("createChangeRequest: throws PolicyDeniedError when autoMerge NOT acknowledged", () => {
  assert.throws(() => createChangeRequest(baseInput), PolicyDeniedError);
});

test("applyDecision: approve transitions open → approved", () => {
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  const next = applyDecision(cr, "approve", "alice", "lgtm");
  assert.equal(next.status, "approved");
  assert.equal(next.audit.at(-1)?.actor, "alice");
  assert.equal(next.audit.at(-1)?.action, "approved");
});

test("applyDecision: reject transitions open → rejected", () => {
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  const next = applyDecision(cr, "reject", "bob", "too risky");
  assert.equal(next.status, "rejected");
});

test("applyDecision: cannot reject already-merged", () => {
  const cr = createChangeRequest(baseInput, { autoMergeAcknowledged: true });
  const next = applyDecision(cr, "reject", "bob");
  assert.equal(next.status, "merged");
});

test("isExpired: respects expiresAt", () => {
  const cr = createChangeRequest({ ...baseInput, confidence: 0.3, policy: { ...baseInput.policy, confidence: 0.3 } }, { now: () => new Date("2026-01-01T00:00:00Z") });
  // 25h after creation → expired
  assert.equal(isExpired(cr, new Date("2026-01-02T01:00:00Z")), true);
  // 12h after creation → not expired
  assert.equal(isExpired(cr, new Date("2026-01-01T12:00:00Z")), false);
});

test("fingerprint: stable 12-hex length", () => {
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  const fp = fingerprint(cr);
  assert.match(fp, /^[0-9a-f]{12}$/);
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

test("inbox: add + list + filter by status", () => {
  const inbox = createInbox();
  const a = createChangeRequest({ ...baseInput, confidence: 0.3, policy: { ...baseInput.policy, confidence: 0.3 } });
  const b = createChangeRequest(baseInput, { autoMergeAcknowledged: true });
  inbox.add(a);
  inbox.add(b);
  assert.equal(inbox.size(), 2);
  assert.equal(inbox.list({ status: "open" }).length, 1);
  assert.equal(inbox.list({ status: "merged" }).length, 1);
  assert.equal(inbox.list({ permission: "autoMerge" }).length, 1);
});

test("inbox: approve + reject mutate status", () => {
  const inbox = createInbox();
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  inbox.add(cr);
  inbox.approve(cr.id, "alice", "lgtm");
  assert.equal(inbox.get(cr.id)?.status, "approved");
  inbox.reject(cr.id, "bob", "no");
  assert.equal(inbox.get(cr.id)?.status, "rejected");
});

test("inbox: sweepExpired expires old open items", () => {
  const inbox = createInbox({ clock: () => new Date("2026-01-01T00:00:00Z") });
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
    ttlMs: 1000,
  }, { now: () => new Date("2026-01-01T00:00:00Z") });
  inbox.add(cr);
  const swept = inbox.sweepExpired(new Date("2026-01-02T00:00:00Z"));
  assert.equal(swept, 1);
  assert.equal(inbox.get(cr.id)?.status, "expired");
});

test("inbox: getByFingerprint", () => {
  const inbox = createInbox();
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  inbox.add(cr);
  assert.equal(inbox.getByFingerprint(fingerprint(cr))?.id, cr.id);
});

test("inbox: filter by sinceHours", () => {
  const inbox = createInbox({ clock: () => new Date("2026-01-02T00:00:00Z") });
  const old = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  }, { now: () => new Date("2026-01-01T00:00:00Z") });
  inbox.add(old);
  assert.equal(inbox.list({ sinceHours: 12 }).length, 0);
  assert.equal(inbox.list({ sinceHours: 48 }).length, 1);
});

// ---------------------------------------------------------------------------
// Octokit
// ---------------------------------------------------------------------------

test("buildPrDraft: includes agent, model, rationale, file summary", () => {
  const cr = createChangeRequest({
    ...baseInput,
    confidence: 0.3,
    policy: { ...baseInput.policy, confidence: 0.3 },
  });
  const draft = buildPrDraft(cr, "main");
  assert.match(draft.title, /\[DadaBot changeRequest\]/);
  assert.match(draft.body, /claude-4/);
  assert.match(draft.body, /anthropic\/claude-sonnet-4\.5/);
  assert.match(draft.body, /Reduce API cost/);
  assert.match(draft.body, /apps\/web\/src\/routes\/FindPage\.tsx/);
  assert.deepEqual(draft.labels.slice(0, 2), ["dadabot", "human-in-the-loop"]);
  assert.equal(draft.base, "main");
  assert.match(draft.head, /^dadabot\/cr-/);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test("audit: memory logger records entries", async () => {
  const log = createMemoryAuditLogger();
  await log.log({ at: new Date().toISOString(), actor: "x", action: "y" });
  assert.equal(log.entries.length, 1);
});
