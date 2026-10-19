// contributions.test.ts — Contributor registry lifecycle + reputation-weighted rewards.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createContributionRegistry } from "../src/contributions.ts";

let reg: ReturnType<typeof createContributionRegistry>;

beforeEach(() => {
  reg = createContributionRegistry();
});

test("submit creates a pending contribution", () => {
  const c = reg.submit({
    kind: "model-adapter",
    contributorId: "alice",
    title: "groq-llama3-adapter",
    artifact: "https://github.com/x/y",
  });
  assert.equal(c.status, "pending");
  assert.equal(c.rewardIssued, 0);
  assert.equal(c.usageCount, 0);
});

test("verify(accept) marks verified and computes reward", () => {
  const c = reg.submit({
    kind: "model-adapter",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  const v = reg.verify(c.id, true, "lgtm", 100);
  assert.equal(v.status, "verified");
  // base 500 × repMul (1.0 + 100/1000 = 1.1) = 550
  assert.equal(v.rewardIssued, 550);
});

test("verify(reject) sets status=rejected with 0 reward", () => {
  const c = reg.submit({
    kind: "tool-mcp-server",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  const v = reg.verify(c.id, false, "duplicate");
  assert.equal(v.status, "rejected");
  assert.equal(v.rewardIssued, 0);
});

test("reputation multiplier caps at 2.0", () => {
  const c = reg.submit({
    kind: "bug-report",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  const v = reg.verify(c.id, true, "ok", 5000); // huge reputation
  // base 100 × min(2.0, 1 + 5000/1000) = 100 × 2.0 = 200
  assert.equal(v.rewardIssued, 200);
});

test("recordUsage increments count", () => {
  const c = reg.submit({
    kind: "tool-mcp-server",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  reg.verify(c.id, true, "ok", 0);
  reg.recordUsage(c.id);
  reg.recordUsage(c.id);
  assert.equal(reg.list()[0]!.usageCount, 2);
});

test("recordUsage awards milestone bonus at 100/200/...", () => {
  const c = reg.submit({
    kind: "tool-mcp-server",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  reg.verify(c.id, true, "ok", 0);
  const initialReward = reg.list()[0]!.rewardIssued;
  for (let i = 0; i < 100; i++) reg.recordUsage(c.id);
  const after = reg.list()[0]!.rewardIssued;
  assert.equal(after, initialReward + 10, "100-uses milestone grants 10 points");
});

test("list filters by contributorId, kind, status", () => {
  reg.submit({ kind: "model-adapter", contributorId: "alice", title: "a", artifact: "x" });
  reg.submit({ kind: "bug-report", contributorId: "bob", title: "b", artifact: "y" });
  reg.submit({ kind: "model-adapter", contributorId: "alice", title: "c", artifact: "z" });
  assert.equal(reg.list({ contributorId: "alice" }).length, 2);
  assert.equal(reg.list({ kind: "bug-report" }).length, 1);
  assert.equal(reg.list({ status: "pending" }).length, 3);
});

test("verify on unknown id throws", () => {
  assert.throws(() => reg.verify("nope", true), /contribution_not_found/);
});

test("computeReward returns base when rep=0", () => {
  const c = reg.submit({
    kind: "doc-tutorial",
    contributorId: "alice",
    title: "x",
    artifact: "y",
  });
  reg.verify(c.id, true, "ok", 0);
  // base 50 × 1.0 = 50
  assert.equal(reg.list()[0]!.rewardIssued, 50);
});
