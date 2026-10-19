// retention.test.ts — 7d/30d retention + AI usage rate.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRetentionTracker } from "../src/retention.ts";

let ret: ReturnType<typeof createRetentionTracker>;

beforeEach(() => {
  ret = createRetentionTracker();
});

test("signup increments totalUsers", () => {
  ret.signup("u1");
  ret.signup("u2");
  assert.equal(ret.stats().totalUsers, 2);
});

test("activity increments active counts", () => {
  ret.signup("u1");
  ret.activity("u1");
  const s = ret.stats();
  assert.equal(s.usersActive7d, 1);
  assert.equal(s.aiUsageRate, 1);
});

test("signup is idempotent", () => {
  ret.signup("u1");
  ret.signup("u1");
  assert.equal(ret.stats().totalUsers, 1);
});

test("retention7d vs 30d", () => {
  const now = Date.now();
  const day = 86_400_000;
  ret.signup("u-old", now - 90 * day);
  ret.activity("u-old", now - 60 * day); // last activity 60d ago → 0 in 7d/30d
  ret.signup("u-mid", now - 20 * day);
  ret.activity("u-mid", now - 10 * day); // 10d ago → not in 7d, in 30d
  ret.signup("u-new", now - 3 * day);
  ret.activity("u-new", now - 1 * day); // 1d ago → in 7d & 30d

  const s = ret.stats(now);
  assert.equal(s.totalUsers, 3);
  assert.equal(s.usersActive7d, 1, "only u-new in 7d");
  assert.equal(s.usersActive30d, 2, "u-new + u-mid in 30d");
});

test("aiUsageRate = % of users with any activity", () => {
  ret.signup("a");
  ret.signup("b");
  ret.signup("c");
  ret.activity("a");
  ret.activity("b");
  assert.equal(ret.stats().aiUsageRate, 2 / 3);
});

test("dump reports signup + activity counts", () => {
  ret.signup("u1");
  ret.signup("u2");
  ret.activity("u1");
  ret.activity("u1");
  const d = ret.dump();
  assert.equal(d.signups, 2);
  assert.equal(d.activities, 2);
});

test("empty tracker returns zeros", () => {
  const s = ret.stats();
  assert.equal(s.totalUsers, 0);
  assert.equal(s.retentionRate7d, 0);
  assert.equal(s.retentionRate30d, 0);
  assert.equal(s.aiUsageRate, 0);
});

test("reset clears state", () => {
  ret.signup("u1");
  ret.activity("u1");
  ret.reset();
  const s = ret.stats();
  assert.equal(s.totalUsers, 0);
  assert.equal(ret.dump().signups, 0);
});
