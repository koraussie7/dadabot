// ledger.test.ts — Core ledger operations.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createLedger,
  InsufficientPointsError,
  DuplicateIdempotencyKeyError,
} from "../src/ledger.ts";

let ledger: ReturnType<typeof createLedger>;

beforeEach(() => {
  ledger = createLedger();
});

test("issue creates an entry and updates balance", () => {
  const e = ledger.issue("u1", 100, { reason: "signup-bonus" });
  assert.equal(e.amount, 100);
  assert.equal(e.kind, "issue");
  assert.match(e.id, /^[0-9a-f-]{36}$/);
  const bal = ledger.balanceOf("u1");
  assert.equal(bal.available, 100);
  assert.equal(bal.lifetimeIssued, 100);
  assert.equal(bal.lifetimeSpent, 0);
});

test("spend deducts balance", () => {
  ledger.issue("u1", 100, { reason: "signup-bonus" });
  const e = ledger.spend("u1", 30, { reason: "ai-chat" });
  assert.equal(e.amount, -30);
  assert.equal(ledger.balanceOf("u1").available, 70);
  assert.equal(ledger.balanceOf("u1").lifetimeSpent, 30);
});

test("spend throws InsufficientPointsError", () => {
  ledger.issue("u1", 10, { reason: "signup-bonus" });
  assert.throws(
    () => ledger.spend("u1", 50, { reason: "ai-chat" }),
    (e: unknown) => e instanceof InsufficientPointsError && e.userId === "u1" && e.requested === 50 && e.available === 10,
  );
});

test("issue with negative amount throws", () => {
  assert.throws(() => ledger.issue("u1", -1, { reason: "signup-bonus" }), /positive/);
});

test("spend with zero amount throws", () => {
  assert.throws(() => ledger.spend("u1", 0, { reason: "ai-chat" }), /positive/);
});

test("transfer moves points atomically", () => {
  ledger.issue("u1", 100, { reason: "admin-grant" });
  const r = ledger.transfer("u1", "u2", 30, { reason: "system-adjust" });
  assert.equal(r.out.amount, -30);
  assert.equal(r.in.amount, 30);
  assert.equal(r.out.counterparty, "u2");
  assert.equal(r.in.counterparty, "u1");
  assert.equal(ledger.balanceOf("u1").available, 70);
  assert.equal(ledger.balanceOf("u2").available, 30);
});

test("transfer refuses when sender lacks funds", () => {
  ledger.issue("u1", 5, { reason: "admin-grant" });
  assert.throws(
    () => ledger.transfer("u1", "u2", 10, { reason: "system-adjust" }),
    (e: unknown) => e instanceof InsufficientPointsError,
  );
});

test("transfer to self throws", () => {
  ledger.issue("u1", 100, { reason: "admin-grant" });
  assert.throws(() => ledger.transfer("u1", "u1", 10, { reason: "system-adjust" }), /self/);
});

test("idempotency key prevents double-issue", () => {
  const key = "signup-u1-2026-10";
  ledger.issue("u1", 100, { reason: "signup-bonus", idempotencyKey: key });
  assert.throws(
    () => ledger.issue("u1", 100, { reason: "signup-bonus", idempotencyKey: key }),
    (e: unknown) => e instanceof DuplicateIdempotencyKeyError,
  );
  assert.equal(ledger.balanceOf("u1").available, 100, "no double-credit");
});

test("different idempotency keys are independent", () => {
  ledger.issue("u1", 100, { reason: "signup-bonus", idempotencyKey: "k1" });
  ledger.issue("u1", 100, { reason: "signup-bonus", idempotencyKey: "k2" });
  assert.equal(ledger.balanceOf("u1").available, 200);
});

test("historyOf returns user's entries newest-first", () => {
  ledger.issue("u1", 100, { reason: "signup-bonus" });
  ledger.spend("u1", 30, { reason: "ai-chat" });
  ledger.spend("u1", 20, { reason: "ai-translate" });
  const h = ledger.historyOf("u1");
  assert.equal(h.length, 3);
  assert.equal(h[0]!.amount, -20, "newest first");
  assert.equal(h[1]!.amount, -30);
  assert.equal(h[2]!.amount, 100);
});

test("historyOf respects limit", () => {
  for (let i = 0; i < 10; i++) ledger.issue("u1", 1, { reason: "admin-grant", idempotencyKey: `k${i}` });
  assert.equal(ledger.historyOf("u1", 5).length, 5);
  assert.equal(ledger.historyOf("u1", 0).length, 10);
});

test("listUsers returns all known users", () => {
  ledger.issue("u1", 1, { reason: "admin-grant" });
  ledger.issue("u2", 1, { reason: "admin-grant" });
  ledger.spend("u1", 1, { reason: "ai-chat" });
  const users = ledger.listUsers().sort();
  assert.deepEqual(users, ["u1", "u2"]);
});

test("balanceOf auto-creates zero entry for new user", () => {
  const b = ledger.balanceOf("u-new");
  assert.equal(b.available, 0);
  assert.equal(b.lifetimeIssued, 0);
  assert.equal(b.lifetimeSpent, 0);
});
