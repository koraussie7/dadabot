/**
 * allowlist.test.ts — policy gate.
 *
 * Covers plan scenarios T1 (unknown target), T2 (arbitrary shell),
 * T5 (cooldown / attempts) and T6 (policy file changed under a running
 * executor), plus schema hardening.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPolicy,
  parsePolicy,
  PolicyLoadError,
  recordAttempt,
  resetAttempts,
  validateAction,
  type AttemptRecord,
  type LoadedPolicy,
} from "../src/allowlist.ts";
import type { InfraAction, InfraTarget } from "../src/types.ts";

const TARGETS: InfraTarget[] = [
  { name: "proxy01", group: "proxy_nodes" },
  { name: "app01", group: "app_nodes" },
];

const VALID_POLICY = JSON.stringify({
  version: 1,
  mode: "allowlist",
  targetGroup: "proxy_nodes",
  actions: {
    health_check: { automatic: true, reversible: true, maxAttempts: 2, cooldownSeconds: 60 },
    "nginx.validate": { automatic: true, reversible: true },
    "service.restart": {
      automatic: true,
      reversible: true,
      maxAttempts: 1,
      allow: ["nginx"],
    },
    "read_logs": { automatic: true, reversible: true, maxLines: 200 },
    "config.rollback": { automatic: true, reversible: false },
  },
});

function withPolicy(text: string): { loaded: LoadedPolicy; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "infra-policy-"));
  const path = join(dir, "allowed-actions.json");
  writeFileSync(path, text, "utf8");
  return { loaded: loadPolicy(path), dir, path };
}

function act(partial: Partial<InfraAction> & Pick<InfraAction, "id">): InfraAction {
  return { target: "proxy01", ...partial } as InfraAction;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
test("policy: unknown action id is rejected loudly, not ignored", () => {
  const bad = JSON.stringify({
    version: 1,
    mode: "allowlist",
    actions: { "shell.arbitrary": { automatic: true, reversible: false } },
  });
  assert.throws(
    () => parsePolicy(bad),
    (err: unknown) => err instanceof PolicyLoadError && err.code === "UNKNOWN_ACTION",
  );
});

test("policy: unknown top-level key is rejected (typo protection)", () => {
  const bad = JSON.stringify({
    version: 1,
    mode: "allowlist",
    targets: [],
    actions: {},
    extraKey: true,
  });
  assert.throws(
    () => parsePolicy(bad),
    (err: unknown) => err instanceof PolicyLoadError && err.code === "SCHEMA_ERROR",
  );
});

test("policy: mode must be allowlist", () => {
  const bad = JSON.stringify({ version: 1, mode: "denylist", actions: {} });
  assert.throws(() => parsePolicy(bad), PolicyLoadError);
});

// ---------------------------------------------------------------------------
// T1 — unknown target
// ---------------------------------------------------------------------------
test("T1: target absent from inventory is refused", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(loaded, act({ id: "health_check", target: "prod-db" }), {
    targets: TARGETS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_NOT_ALLOWED");
});

test("T1b: target outside policy.targetGroup is refused", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(loaded, act({ id: "health_check", target: "app01" }), {
    targets: TARGETS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_NOT_ALLOWED");
});

// ---------------------------------------------------------------------------
// T2 — arbitrary shell
// ---------------------------------------------------------------------------
test("T2: arbitrary shell is unrepresentable and refused", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  // Force an id through the JSON boundary the way a hostile caller would.
  const result = validateAction(
    loaded,
    act({ id: "shell.arbitrary" as InfraAction["id"] }),
    { targets: TARGETS },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_ACTION");
});

test("T2b: action present in types but absent from policy is refused", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(loaded, act({ id: "caddy.validate" }), { targets: TARGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ACTION_NOT_ALLOWED");
});

test("T2c: automatic=false disables an otherwise-valid action", () => {
  const { loaded } = withPolicy(
    JSON.stringify({
      version: 1,
      mode: "allowlist",
      targetGroup: "proxy_nodes",
      actions: { health_check: { automatic: false, reversible: true } },
    }),
  );
  const result = validateAction(loaded, act({ id: "health_check" }), { targets: TARGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ACTION_DISABLED");
});

// ---------------------------------------------------------------------------
// Hardcoded escalation gates — editing JSON cannot widen these
// ---------------------------------------------------------------------------
test("gate: service.restart needs approval even with automatic=true", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const denied = validateAction(
    loaded,
    act({ id: "service.restart", service: "nginx" }),
    { targets: TARGETS },
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "APPROVAL_REQUIRED");

  const approved = validateAction(
    loaded,
    act({ id: "service.restart", service: "nginx" }),
    { targets: TARGETS, approved: true },
  );
  assert.equal(approved.ok, true);
});

test("gate: config.rollback needs approval even with automatic=true", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(loaded, act({ id: "config.rollback" }), { targets: TARGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_REQUIRED");
});

test("gate: charon restart is blocked by policy.allow even when approved", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(
    loaded,
    act({ id: "service.restart", service: "charon" }),
    { targets: TARGETS, approved: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "SERVICE_NOT_ALLOWED");
  assert.match(result.reason, /charon/);
});

test("gate: target-level service restriction is enforced", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const restricted: InfraTarget[] = [
    { name: "proxy01", group: "proxy_nodes", allowedServices: ["traefik"] },
  ];
  const result = validateAction(
    loaded,
    act({ id: "service.restart", service: "nginx" }),
    { targets: restricted, approved: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "SERVICE_NOT_ALLOWED");
});

test("gate: service.restart without a service name is invalid", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const result = validateAction(loaded, act({ id: "service.restart" }), {
    targets: TARGETS,
    approved: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_ARGUMENT");
});

// ---------------------------------------------------------------------------
// T5 — cooldown + attempts
// ---------------------------------------------------------------------------
test("T5: attempts beyond maxAttempts are refused", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const attempts = new Map<string, AttemptRecord>();
  // maxAttempts=2, cooldownSeconds=60 — space each attempt past the cooldown
  // so this test isolates the attempt budget from the cooldown rule.
  const t0 = 1_000_000;

  const action = act({ id: "health_check" });
  for (let i = 0; i < 2; i++) {
    const now = t0 + i * 61_000;
    const ok = validateAction(loaded, action, { targets: TARGETS, now, attempts });
    assert.equal(ok.ok, true, `attempt ${i + 1} should pass: ${ok.reason}`);
    recordAttempt(attempts, action, now);
  }

  const third = validateAction(loaded, action, {
    targets: TARGETS,
    now: t0 + 2 * 61_000,
    attempts,
  });
  assert.equal(third.ok, false);
  assert.equal(third.code, "ATTEMPTS_EXHAUSTED");
});

test("T5b: cooldown blocks a second run inside the window", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const attempts = new Map<string, AttemptRecord>();
  const action = act({ id: "health_check" });
  const t0 = 1_000_000;

  recordAttempt(attempts, action, t0);

  const tooSoon = validateAction(loaded, action, { targets: TARGETS, now: t0 + 30_000, attempts });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.code, "COOLDOWN_ACTIVE");

  const laterOk = validateAction(loaded, action, { targets: TARGETS, now: t0 + 61_000, attempts });
  assert.equal(laterOk.ok, true);
});

test("T5c: refused actions do not burn attempt budget (validate never mutates)", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  const attempts = new Map<string, AttemptRecord>();
  const now = 1_000_000;
  const badTarget = act({ id: "health_check", target: "prod-db" });

  for (let i = 0; i < 10; i++) {
    validateAction(loaded, badTarget, { targets: TARGETS, now, attempts });
  }
  assert.equal(attempts.size, 0);
});

test("T5d: resetAttempts clears one budget or all", () => {
  const attempts = new Map<string, AttemptRecord>();
  const a = act({ id: "health_check", target: "proxy01" });
  const b = act({ id: "health_check", target: "proxy01" });
  recordAttempt(attempts, a, 1);
  recordAttempt(attempts, b, 1);
  assert.equal(attempts.size, 1);

  resetAttempts(attempts, a);
  assert.equal(attempts.size, 0);

  recordAttempt(attempts, a, 1);
  resetAttempts(attempts);
  assert.equal(attempts.size, 0);
});

// ---------------------------------------------------------------------------
// T6 — policy changed under a running executor
// ---------------------------------------------------------------------------
test("T6: editing the policy file mid-flight forces POLICY_STALE", () => {
  const { loaded, path } = withPolicy(VALID_POLICY);
  const action = act({ id: "health_check" });

  assert.equal(validateAction(loaded, action, { targets: TARGETS }).ok, true);

  // Attacker (or careless operator) widens the policy after load.
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      mode: "allowlist",
      actions: { health_check: { automatic: true, reversible: true }, "service.restart": { automatic: true, reversible: true } },
    }),
    "utf8",
  );

  const afterEdit = validateAction(loaded, action, { targets: TARGETS });
  assert.equal(afterEdit.ok, false);
  assert.equal(afterEdit.code, "POLICY_STALE");

  // Only an explicit reload trusts the new file.
  const reloaded = loadPolicy(path);
  assert.equal(validateAction(reloaded, action, { targets: TARGETS }).ok, true);
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------
test("args: read_logs rejects non-positive / fractional line counts", () => {
  const { loaded } = withPolicy(VALID_POLICY);
  for (const lines of [0, -5, 1.5]) {
    const r = validateAction(loaded, act({ id: "read_logs", lines }), { targets: TARGETS });
    assert.equal(r.ok, false, `lines=${lines}`);
    assert.equal(r.code, "INVALID_ARGUMENT");
  }
});

test("args: http.probe requires an http(s) url", () => {
  const { loaded } = withPolicy(
    JSON.stringify({
      version: 1,
      mode: "allowlist",
      targetGroup: "proxy_nodes",
      actions: { "http.probe": { automatic: true, reversible: true } },
    }),
  );
  const bad = validateAction(loaded, act({ id: "http.probe", url: "file:///etc/passwd" }), {
    targets: TARGETS,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "INVALID_ARGUMENT");

  const good = validateAction(loaded, act({ id: "http.probe", url: "https://muhanai.com/" }), {
    targets: TARGETS,
  });
  assert.equal(good.ok, true);
});
