// rewards.test.ts — Reward engine + campaign rules.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createLedger } from "../src/ledger.ts";
import { createRewardEngine } from "../src/rewards.ts";

let ledger: ReturnType<typeof createLedger>;
let rewards: ReturnType<typeof createRewardEngine>;

beforeEach(() => {
  ledger = createLedger();
  rewards = createRewardEngine(ledger);
});

test("default campaign rewards signup-bonus", () => {
  rewards.registerCampaign({
    id: "default",
    name: "default",
    priority: 1,
    active: true,
    rules: [{ id: "r-signup", trigger: "signup-bonus", amount: 100 }],
  });
  const r = rewards.fire({ userId: "u1", reason: "signup-bonus" });
  assert.equal(r.fired, true);
  assert.equal(r.entry?.amount, 100);
  assert.equal(ledger.balanceOf("u1").available, 100);
});

test("no campaign = no_match", () => {
  const r = rewards.fire({ userId: "u1", reason: "signup-bonus" });
  assert.equal(r.fired, false);
  assert.equal(r.reason, "no_match");
});

test("higher-priority campaign overrides lower", () => {
  rewards.registerCampaign({
    id: "default",
    name: "default",
    priority: 1,
    active: true,
    rules: [{ id: "r-signup", trigger: "signup-bonus", amount: 100 }],
  });
  rewards.registerCampaign({
    id: "launch",
    name: "launch-week",
    priority: 10,
    active: true,
    rules: [{ id: "r-signup-launch", trigger: "signup-bonus", amount: 250 }],
  });
  const r = rewards.fire({ userId: "u1", reason: "signup-bonus" });
  assert.equal(r.campaign?.id, "launch");
  assert.equal(r.entry?.amount, 250);
});

test("inactive campaign is skipped", () => {
  rewards.registerCampaign({
    id: "paused",
    name: "paused",
    priority: 99,
    active: false,
    rules: [{ id: "r-signup", trigger: "signup-bonus", amount: 999 }],
  });
  rewards.registerCampaign({
    id: "default",
    name: "default",
    priority: 1,
    active: true,
    rules: [{ id: "r-signup-d", trigger: "signup-bonus", amount: 50 }],
  });
  const r = rewards.fire({ userId: "u1", reason: "signup-bonus" });
  assert.equal(r.campaign?.id, "default");
  assert.equal(r.entry?.amount, 50);
});

test("expired rule returns reason='expired'", () => {
  rewards.registerCampaign({
    id: "c1",
    name: "c1",
    priority: 1,
    active: true,
    rules: [
      { id: "r-old", trigger: "signup-bonus", amount: 100, expiresAt: Date.now() - 1000 },
    ],
  });
  const r = rewards.fire({ userId: "u1", reason: "signup-bonus" });
  assert.equal(r.fired, false);
  assert.equal(r.reason, "expired");
});

test("per-user cap blocks repeat firing", () => {
  rewards.registerCampaign({
    id: "c1",
    name: "c1",
    priority: 1,
    active: true,
    rules: [
      { id: "r-once", trigger: "first-ai-call", amount: 50, perUserCap: 1 },
    ],
  });
  const r1 = rewards.fire({ userId: "u1", reason: "first-ai-call" });
  assert.equal(r1.fired, true);
  const r2 = rewards.fire({ userId: "u1", reason: "first-ai-call" });
  assert.equal(r2.fired, false);
  assert.equal(r2.reason, "per_user_cap");
});

test("min-spend guard prevents payout to non-active users", () => {
  rewards.registerCampaign({
    id: "c1",
    name: "c1",
    priority: 1,
    active: true,
    rules: [
      {
        id: "r-power-user",
        trigger: "weekly-challenge",
        amount: 200,
        minUserSpend: 100,
      },
    ],
  });
  // No prior spend → blocked
  const r1 = rewards.fire({ userId: "u1", reason: "weekly-challenge" });
  assert.equal(r1.fired, false);
  assert.equal(r1.reason, "min_spend");

  // After enough spend → fires
  ledger.issue("u1", 500, { reason: "admin-grant" });
  ledger.spend("u1", 200, { reason: "ai-code" });
  const r2 = rewards.fire({ userId: "u1", reason: "weekly-challenge" });
  assert.equal(r2.fired, true);
});

test("idempotent fire returns same entry on retry", () => {
  rewards.registerCampaign({
    id: "c1",
    name: "c1",
    priority: 1,
    active: true,
    rules: [{ id: "r1", trigger: "signup-bonus", amount: 100 }],
  });
  const r1 = rewards.fire({ userId: "u1", reason: "signup-bonus", idempotencyKey: "abc" });
  assert.equal(r1.fired, true);
  const r2 = rewards.fire({ userId: "u1", reason: "signup-bonus", idempotencyKey: "abc" });
  assert.equal(r2.fired, true);
  // same entry id (the ledger dedupes by key)
  assert.equal(r2.entry?.id, r1.entry?.id);
  assert.equal(ledger.balanceOf("u1").available, 100, "no double-credit");
});

test("listCampaigns sorted by priority desc", () => {
  rewards.registerCampaign({ id: "low", name: "low", priority: 1, active: true, rules: [] });
  rewards.registerCampaign({ id: "high", name: "high", priority: 10, active: true, rules: [] });
  const list = rewards.listCampaigns();
  assert.equal(list[0]!.id, "high");
  assert.equal(list[1]!.id, "low");
});
