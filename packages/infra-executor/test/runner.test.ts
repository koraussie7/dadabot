/**
 * runner.test.ts — argv construction and spawn safety.
 *
 * The critical property: no action ever reaches a shell. These tests assert
 * on the exact argv produced, so a refactor that starts concatenating strings
 * fails here rather than in production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_BINARIES, buildCommand, createRecordingRunner, createSpawnRunner } from "../src/runner.ts";
import type { InfraAction } from "../src/types.ts";

function act(partial: Partial<InfraAction> & Pick<InfraAction, "id">): InfraAction {
  return { target: "proxy01", ...partial } as InfraAction;
}

// ---------------------------------------------------------------------------
// argv construction
// ---------------------------------------------------------------------------
test("nginx validate uses `nginx -t`", () => {
  const spec = buildCommand(act({ id: "nginx.validate" }));
  assert.equal(spec.command, "nginx");
  assert.deepEqual(spec.argv, ["-t"]);
});

test("nginx reload uses `-s reload` because the systemd unit is masked", () => {
  const spec = buildCommand(act({ id: "nginx.reload" }));
  assert.equal(spec.command, "nginx");
  assert.deepEqual(spec.argv, ["-s", "reload"]);
  // Guard against someone "fixing" this to systemctl — it does not exist here.
  assert.notEqual(spec.command, "systemctl");
});

test("service.restart nginx maps to reload, not restart", () => {
  const spec = buildCommand(act({ id: "service.restart", service: "nginx" }));
  assert.deepEqual(spec.argv, ["-s", "reload"]);
});

test("service.restart charon and caddy target the charon container", () => {
  for (const service of ["charon", "caddy"] as const) {
    const spec = buildCommand(act({ id: "service.restart", service }));
    assert.equal(spec.command, "docker");
    assert.deepEqual(spec.argv, ["restart", "charon"]);
  }
});

test("read_logs clamps lines and passes them as a separate argv element", () => {
  const spec = buildCommand(act({ id: "read_logs", lines: 50 }));
  assert.equal(spec.command, "journalctl");
  assert.deepEqual(spec.argv, ["-n", "50", "--no-pager"]);

  const huge = buildCommand(act({ id: "read_logs", lines: 999_999 }));
  assert.equal(huge.argv[1], "10000", "lines must be clamped to 10000");
});

test("read_logs rejects junk line counts instead of stringifying them", () => {
  for (const lines of [0, -1, 2.5]) {
    assert.throws(() => buildCommand(act({ id: "read_logs", lines })), /positive integer/);
  }
});

test("http.probe requires an http(s) url", () => {
  assert.throws(() => buildCommand(act({ id: "http.probe" })), /url must be http/);
  assert.throws(() => buildCommand(act({ id: "http.probe", url: "file:///etc/passwd" })), /url must be http/);

  const spec = buildCommand(act({ id: "http.probe", url: "https://bot.muhanai.com/" }));
  assert.equal(spec.command, "curl");
  assert.ok(spec.argv.includes("https://bot.muhanai.com/"));
});

test("config.rollback is not a subprocess action", () => {
  assert.throws(() => buildCommand(act({ id: "config.rollback" })), /not a subprocess action/);
});

// ---------------------------------------------------------------------------
// No shell metacharacters survive as an argv element boundary
// ---------------------------------------------------------------------------
test("injected separators stay inside a single argv element", () => {
  const url = "https://example.com/; rm -rf /";
  const spec = buildCommand(act({ id: "http.probe", url }));
  // The whole string is one argv entry — the shell-free spawn would treat it
  // as a literal URL, never as two commands.
  assert.equal(spec.argv.filter((a) => a.includes("rm -rf")).length, 1);
  // -fsS -o /dev/null -w %{http_code} --max-time 10 <url>  →  8 argv entries
  assert.equal(spec.argv.length, 8);
});

// ---------------------------------------------------------------------------
// Binary allowlist
// ---------------------------------------------------------------------------
test("every binary buildCommand can emit is on ALLOWED_BINARIES", () => {
  const actions: InfraAction[] = [
    act({ id: "nginx.validate" }),
    act({ id: "nginx.reload" }),
    act({ id: "caddy.validate" }),
    act({ id: "docker.inspect" }),
    act({ id: "read_logs" }),
    act({ id: "health_check" }),
    act({ id: "http.probe", url: "https://muhanai.com/" }),
    act({ id: "service.restart", service: "nginx" }),
    act({ id: "service.restart", service: "charon" }),
    act({ id: "service.restart", service: "traefik" }),
  ];
  for (const action of actions) {
    const spec = buildCommand(action);
    assert.ok(ALLOWED_BINARIES.has(spec.command), `${action.id} emits unlisted binary ${spec.command}`);
  }
});

test("spawn runner refuses a non-allowlisted binary before spawning", async () => {
  const runner = createSpawnRunner();
  await assert.rejects(
    () => runner.run("sh", ["-c", "id"]),
    /refusing to spawn non-allowlisted binary/,
  );
});

test("spawn runner refuses a path-qualified shim of a listed binary", async () => {
  const runner = createSpawnRunner();
  // basename is "sh", still not allowed
  await assert.rejects(() => runner.run("/bin/sh", ["-c", "id"]), /non-allowlisted/);
});

// ---------------------------------------------------------------------------
// Recording runner
// ---------------------------------------------------------------------------
test("recording runner replays exact matches only, once each", async () => {
  const runner = createRecordingRunner([
    { command: "nginx", argv: ["-t"], exitCode: 0, stdout: "ok" },
    { command: "nginx", argv: ["-t"], exitCode: 1, stderr: "boom" },
  ]);

  const first = await runner.run("nginx", ["-t"]);
  assert.equal(first.exitCode, 0);

  const second = await runner.run("nginx", ["-t"]);
  assert.equal(second.exitCode, 1);

  // Script exhausted → falls back to defaults (0)
  const third = await runner.run("nginx", ["-t"]);
  assert.equal(third.exitCode, 0);
  assert.equal(runner.calls.length, 3);
});

test("recording runner does not match a prefix of the argv", async () => {
  const runner = createRecordingRunner([
    { command: "nginx", argv: ["-t", "-q"], exitCode: 42 },
  ]);
  const result = await runner.run("nginx", ["-t"]);
  assert.equal(result.exitCode, 0, "partial argv must not match a scripted response");
});
