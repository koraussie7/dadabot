/**
 * inbox-sqlite.test.ts — durable Inbox backend.
 *
 * The JSON inbox rewrites the whole file on every mutation, so two processes
 * (CLI approve + dashboard reject) lose writes. This backend makes each
 * mutation a single transaction and lets the two processes observe each
 * other's changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteInbox, migrateJsonInbox } from "../src/inbox-sqlite.ts";
import {
  createChangeRequest,
  fingerprint,
  type ChangeRequest,
  type CreateChangeRequestInput,
} from "../src/change-request.ts";
import type { PolicyContext } from "../src/policy.ts";

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), "dadabot-inbox-")), "inbox.db");
}

const POLICY: PolicyContext = {
  confidence: 0.5,
  category: "file_edit",
  reversible: true,
  touchesProtected: false,
  autonomyLevel: 1,
};

function makeCr(overrides: Partial<CreateChangeRequestInput> = {}): ChangeRequest {
  return createChangeRequest({
    agent: { name: "claude-sonnet", version: "0.1.0", modelProvider: "anthropic", modelId: "sonnet" },
    title: overrides.title ?? "Change something",
    rationale: "because",
    category: "file_edit",
    confidence: 0.5,
    reversible: true,
    files: [{ path: "src/a.ts", operation: "modify", content: "x", linesAdded: 1, linesRemoved: 0 }],
    policy: POLICY,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------
test("sqlite inbox: add + get + list survives process restart", () => {
  const path = tempDb();
  const cr = makeCr({ title: "persist me" });

  const first = createSqliteInbox({ path });
  first.add(cr);
  first.close();

  const second = createSqliteInbox({ path });
  const loaded = second.get(cr.id);
  assert.ok(loaded, "ChangeRequest must be readable after reopen");
  assert.equal(loaded.title, "persist me");
  assert.equal(loaded.files.length, 1, "files array must round-trip");
  assert.equal(loaded.files[0]?.path, "src/a.ts");
  assert.equal(second.size(), 1);
  second.close();
});

test("sqlite inbox: approve/reject are persisted, not just in-memory", () => {
  const path = tempDb();
  const cr = makeCr();
  const inbox = createSqliteInbox({ path });
  inbox.add(cr);
  inbox.approve(cr.id, "brian", "looks good");
  inbox.close();

  const reopened = createSqliteInbox({ path });
  const loaded = reopened.get(cr.id);
  assert.equal(loaded?.status, "approved");
  assert.ok(
    loaded?.audit.some((a) => a.actor === "brian" && a.action === "approved"),
    "audit entry for the approval must persist",
  );
  reopened.close();
});

test("sqlite inbox: approve on an unknown id throws", () => {
  const inbox = createSqliteInbox({ path: tempDb() });
  assert.throws(() => inbox.approve("nope", "brian"), /not found/);
  inbox.close();
});

// ---------------------------------------------------------------------------
// The actual bug the JSON store has: concurrent writers
// ---------------------------------------------------------------------------
test("sqlite inbox: two independent handles do not lose each other's writes", () => {
  const path = tempDb();

  // Two "processes" over the same database, as in CLI + dashboard.
  const cli = createSqliteInbox({ path });
  const dashboard = createSqliteInbox({ path });

  const a = makeCr({ title: "from cli" });
  const b = makeCr({ title: "from dashboard" });

  cli.add(a);
  dashboard.add(b);

  // README claim: both writes survive without a full-file rewrite race.
  assert.equal(cli.size(), 2);
  assert.equal(dashboard.size(), 2);
  assert.equal(cli.get(b.id)?.title, "from dashboard");
  assert.equal(dashboard.get(a.id)?.title, "from cli");

  cli.close();
  dashboard.close();
});

test("sqlite inbox: fingerprint lookup is unique across handles", () => {
  const path = tempDb();
  const cr = makeCr({ title: "dup-detect me" });

  const one = createSqliteInbox({ path });
  one.add(cr);

  const two = createSqliteInbox({ path });
  const found = two.getByFingerprint(fingerprint(cr));
  assert.equal(found?.id, cr.id);

  one.close();
  two.close();
});

// ---------------------------------------------------------------------------
// Filtering + expiry
// ---------------------------------------------------------------------------
test("sqlite inbox: list honours status filter and sinceHours", () => {
  const path = tempDb();
  const inbox = createSqliteInbox({ path });

  const open = makeCr({ title: "open one" });
  const approved = makeCr({ title: "approved one" });
  inbox.add(open);
  inbox.add(approved);
  inbox.approve(approved.id, "brian");

  assert.equal(inbox.list({ status: "open" }).length, 1);
  assert.equal(inbox.list({ status: "approved" }).length, 1);
  assert.equal(inbox.list({ status: ["open", "approved"] }).length, 2);
  assert.equal(inbox.list({ sinceHours: 1 }).length, 2);

  inbox.close();
});

test("sqlite inbox: sweepExpired marks stale open requests expired", () => {
  const path = tempDb();
  const inbox = createSqliteInbox({ path });
  const cr = makeCr();
  inbox.add(cr);

  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const swept = inbox.sweepExpired(future);
  assert.equal(swept, 1);
  assert.equal(inbox.get(cr.id)?.status, "expired");

  inbox.close();
});

// ---------------------------------------------------------------------------
// JSON migration
// ---------------------------------------------------------------------------
test("migration: imports legacy inbox.json once and is idempotent", () => {
  const path = tempDb();
  const legacy = [makeCr({ title: "legacy one" }), makeCr({ title: "legacy two" })];

  const inbox = createSqliteInbox({ path });
  const firstCount = migrateJsonInbox(inbox, legacy);
  assert.equal(firstCount, 2);
  assert.equal(inbox.size(), 2);

  // Running again must not duplicate; the id is the primary key.
  const secondCount = migrateJsonInbox(inbox, legacy);
  assert.equal(secondCount, 0);
  assert.equal(inbox.size(), 2);

  inbox.close();
});
