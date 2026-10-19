// referrals.test.ts — Referral graph: codes, signup, activation, stats.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createReferralGraph } from "../src/referrals.ts";

let graph: ReturnType<typeof createReferralGraph>;

beforeEach(() => {
  graph = createReferralGraph();
});

test("ensureCode returns a stable 8-char code", () => {
  const c1 = graph.ensureCode("alice");
  assert.match(c1, /^[A-HJ-NP-Z2-9]{8}$/);
  // idempotent: same inviter → same code
  const c2 = graph.ensureCode("alice");
  assert.equal(c1, c2);
});

test("different inviters get different codes", () => {
  const c1 = graph.ensureCode("alice");
  const c2 = graph.ensureCode("bob");
  assert.notEqual(c1, c2);
});

test("recordSignup creates edge with correct inviter", () => {
  const code = graph.ensureCode("alice");
  const edge = graph.recordSignup("bob", code);
  assert.equal(edge.inviterId, "alice");
  assert.equal(edge.inviteeId, "bob");
  assert.equal(edge.inviteCode, code);
  assert.equal(edge.activated, false);
});

test("markActivated flips flag and sets ts", () => {
  const code = graph.ensureCode("alice");
  graph.recordSignup("bob", code);
  const e = graph.markActivated("bob");
  assert.equal(e?.activated, true);
  assert.ok(typeof e?.activatedAt === "number");
});

test("markActivated is idempotent", () => {
  const code = graph.ensureCode("alice");
  graph.recordSignup("bob", code);
  graph.markActivated("bob");
  const before = graph.invitesBy("alice")[0]!.activatedAt;
  graph.markActivated("bob");
  const after = graph.invitesBy("alice")[0]!.activatedAt;
  assert.equal(before, after);
});

test("invitesBy returns only this inviter's edges, newest first", () => {
  graph.ensureCode("alice");
  graph.recordSignup("bob", graph.ensureCode("alice"));
  graph.recordSignup("carol", graph.ensureCode("alice"));
  graph.recordSignup("dave", graph.ensureCode("alice"));
  const inv = graph.invitesBy("alice");
  assert.equal(inv.length, 3);
  // newest first
  assert.equal(inv[0]!.inviteeId, "dave");
  assert.equal(inv[1]!.inviteeId, "carol");
  assert.equal(inv[2]!.inviteeId, "bob");
});

test("stats compute activation rate", () => {
  const code = graph.ensureCode("alice");
  graph.recordSignup("bob", code);
  graph.recordSignup("carol", code);
  graph.recordSignup("dave", code);
  graph.markActivated("bob");
  graph.markActivated("dave");
  const s = graph.stats("alice");
  assert.equal(s.totalInvites, 3);
  assert.equal(s.activated, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.activationRate, 2 / 3);
});

test("clusterCount reflects anti-gaming signal", () => {
  const code = graph.ensureCode("alice");
  const e1 = graph.recordSignup("bob", code);
  const e2 = graph.recordSignup("carol", code);
  const e3 = graph.recordSignup("dave", code);
  graph.setCluster(e1.id, "ip-1");
  graph.setCluster(e2.id, "ip-1");
  graph.setCluster(e3.id, "ip-2");
  const s = graph.stats("alice");
  assert.equal(s.clusterCount, 2);
});

test("stats on user with no invites returns zeros", () => {
  const s = graph.stats("nobody");
  assert.equal(s.totalInvites, 0);
  assert.equal(s.activated, 0);
  assert.equal(s.activationRate, 0);
});
