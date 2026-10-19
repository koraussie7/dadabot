// budget.test.ts — Budget controller: campaign caps + per-user daily limits.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createLedger } from "../src/ledger.ts";
import { createBudgetController, weeklyCampaignWindow } from "../src/budget.ts";

let ledger: ReturnType<typeof createLedger>;
let budget: ReturnType<typeof createBudgetController>;

beforeEach(() => {
  ledger = createLedger();
  budget = createBudgetController(ledger);
});

test("check returns ok for unknown window", () => {
  const r = budget.check("unknown", 100, "issue");
  assert.equal(r.allowed, true);
});

test("check enforces cap", () => {
  budget.registerWindow({ id: "campaign:launch", cap: 1000, kind: "issue" });
  const r1 = budget.check("campaign:launch", 700, "issue");
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 300);
  // After applying, a second check should be blocked
  budget.apply("campaign:launch", 700, "issue", () => {});
  const r2 = budget.check("campaign:launch", 400, "issue");
  assert.equal(r2.allowed, false);
  assert.equal(r2.reason, "exceeded_cap");
});

test("apply records usage and runs effect", () => {
  budget.registerWindow({ id: "c1", cap: 100, kind: "issue" });
  let ran = false;
  const r = budget.apply("c1", 50, "issue", () => { ran = true; });
  assert.equal(r.allowed, true);
  assert.equal(ran, true);
  assert.equal(budget.usageOf("c1"), 50);
});

test("apply refuses when cap exceeded (does not run effect)", () => {
  budget.registerWindow({ id: "c1", cap: 100, kind: "issue" });
  let ran = false;
  const r = budget.apply("c1", 200, "issue", () => { ran = true; });
  assert.equal(r.allowed, false);
  assert.equal(ran, false, "effect must not run when cap would be exceeded");
});

test("spend window does not count issue operations", () => {
  budget.registerWindow({ id: "spend-cap", cap: 50, kind: "spend" });
  // issuing 100 should NOT count against spend window
  const r = budget.check("spend-cap", 100, "issue");
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "ok");
});

test("checkUserDaily enforces per-kind cap", () => {
  const r1 = budget.checkUserDaily("u1", "ai-chat", 30);
  assert.equal(r1.allowed, true);
  const r2 = budget.checkUserDaily("u1", "ai-chat", 30);
  assert.equal(r2.allowed, false, "second call exceeds daily 50 cap");
  assert.equal(r2.reason, "per_user_limit");
});

test("checkUserDaily different kinds have independent quotas", () => {
  budget.checkUserDaily("u1", "ai-chat", 50);   // hit ai-chat cap
  const r = budget.checkUserDaily("u1", "ai-translate", 100);
  assert.equal(r.allowed, true, "ai-translate quota is independent");
});

test("costOf returns configured cost", () => {
  assert.equal(budget.costOf("ai-chat"), 10);
  assert.equal(budget.costOf("ai-code"), 25);
  assert.equal(budget.costOf("mcp-tool-call"), 3);
});

test("weeklyCampaignWindow resets at end of week", () => {
  const w = weeklyCampaignWindow("launch-week", 10000);
  assert.equal(w.cap, 10000);
  assert.equal(w.kind, "issue");
  assert.ok(w.resetsAt! > Date.now());
});

test("listWindows returns all registered", () => {
  budget.registerWindow({ id: "a", cap: 10, kind: "issue" });
  budget.registerWindow({ id: "b", cap: 20, kind: "spend" });
  assert.equal(budget.listWindows().length, 2);
});

test("reset clears everything", () => {
  budget.registerWindow({ id: "a", cap: 10, kind: "issue" });
  budget.apply("a", 5, "issue", () => {});
  budget.reset();
  assert.equal(budget.listWindows().length, 0);
  assert.equal(budget.usageOf("a"), 0);
});
