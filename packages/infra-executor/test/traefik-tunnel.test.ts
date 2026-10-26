/**
 * traefik-tunnel.test.ts — the tunnel-published path.
 *
 * These actions touch services that sit in front of production traffic:
 * Traefik fronts everything the tunnel publishes, and restarting the tunnel
 * drops every one of those hostnames. The tests below pin the two properties
 * that matter: the argv is fixed and non-shell, and verification fails when
 * the service is up but not actually serving.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecordingRunner, buildCommand, TRAEFIK_COMPOSE, TUNNEL_UNIT } from "../src/runner.ts";
import { verify } from "../src/probes.ts";
import { APPROVAL_REQUIRED, RESTARTABLE_SERVICES } from "../src/types.ts";
import type { InfraAction } from "../src/types.ts";

function act(partial: Partial<InfraAction> & Pick<InfraAction, "id">): InfraAction {
  return { target: "muhanai-vps", ...partial } as InfraAction;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------
test("traefik.validate runs compose config against the test instance", () => {
  const spec = buildCommand(act({ id: "traefik.validate" }));
  assert.equal(spec.command, "docker");
  assert.deepEqual(spec.argv, ["compose", "-f", TRAEFIK_COMPOSE, "config", "-q"]);
  assert.ok(spec.argv.includes("-q"), "must be quiet mode, not a full dump");
});

test("traefik.reload brings the stack up rather than restarting everything", () => {
  const spec = buildCommand(act({ id: "traefik.reload" }));
  assert.deepEqual(spec.argv, ["compose", "-f", TRAEFIK_COMPOSE, "up", "-d"]);
});

test("tunnel actions target the namespaced unit, never the shortmissav one", () => {
  for (const id of ["tunnel.status", "tunnel.restart"] as const) {
    const spec = buildCommand(act({ id }));
    assert.equal(spec.command, "systemctl");
    assert.ok(spec.argv.includes(TUNNEL_UNIT));
    assert.ok(!spec.argv.some((a) => a.includes("shortmissav")), "must not touch the other tunnel");
  }
});

test("cloudflared is restartable only through its own action", () => {
  // service.restart('cloudflared') is reachable but must land on the same unit.
  const spec = buildCommand(act({ id: "service.restart", service: "cloudflared" }));
  assert.deepEqual(spec.argv, ["restart", TUNNEL_UNIT]);
  assert.ok((RESTARTABLE_SERVICES as readonly string[]).includes("cloudflared"));
});

// ---------------------------------------------------------------------------
// escalation
// ---------------------------------------------------------------------------
test("tunnel.restart always requires human approval", () => {
  assert.ok(APPROVAL_REQUIRED.has("tunnel.restart"));
});

test("traefik.reload and validate stay automatic", () => {
  assert.ok(!APPROVAL_REQUIRED.has("traefik.reload"));
  assert.ok(!APPROVAL_REQUIRED.has("traefik.validate"));
});

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------
test("tunnel.status fails when systemd is inactive", async () => {
  const runner = createRecordingRunner([], { exitCode: 0, stdout: "inactive\n" });
  const result = await verify(runner, act({ id: "tunnel.status" }));
  assert.equal(result.ok, false);
  assert.match(result.detail, /inactive/);
});

test("tunnel.status passes when active", async () => {
  const runner = createRecordingRunner([], { exitCode: 0, stdout: "active\n" });
  const result = await verify(runner, act({ id: "tunnel.status" }));
  assert.equal(result.ok, true);
});

test("tunnel.restart checks systemd first, then the public path", async () => {
  const runner = createRecordingRunner([
    { command: "systemctl", argv: ["is-active", TUNNEL_UNIT], exitCode: 0, stdout: "active\n" },
    {
      command: "curl",
      argv: ["-fsS", "--max-time", "20", "https://tunnel-test.muhanai.com/"],
      exitCode: 0,
      stdout: "hostname: whoami\n",
    },
  ]);

  const result = await verify(runner, act({ id: "tunnel.restart" }));
  assert.equal(result.ok, true, result.detail);
  assert.equal(runner.calls.length, 2, "both checks should run");
});

test("tunnel.restart fails when the tunnel is up but the public path is not", async () => {
  // systemd says active, Cloudflare says otherwise — the more dangerous case.
  const runner = createRecordingRunner([
    { command: "systemctl", argv: ["is-active", TUNNEL_UNIT], exitCode: 0, stdout: "active\n" },
    {
      command: "curl",
      argv: ["-fsS", "--max-time", "20", "https://tunnel-test.muhanai.com/"],
      exitCode: 52,
      stderr: "Empty reply from server",
    },
  ]);

  const result = await verify(runner, act({ id: "tunnel.restart" }));
  assert.equal(result.ok, false);
  assert.match(result.detail, /failed|Empty reply/);
});

test("traefik.reload fails when the container is stopped even if /ping answers", async () => {
  const runner = createRecordingRunner([
    {
      command: "curl",
      argv: ["-fsS", "--max-time", "10", "http://127.0.0.1:18090/ping"],
      exitCode: 0,
      stdout: "OK",
    },
    {
      command: "docker",
      argv: ["ps", "--format", "{{.Names}}|{{.Status}}"],
      exitCode: 0,
      stdout: "muhanai-traefik-test|Exited (1) 2 minutes ago\n",
    },
  ]);

  const result = await verify(runner, act({ id: "traefik.reload" }));
  assert.equal(result.ok, false);
  assert.match(result.detail, /not running/);
});
