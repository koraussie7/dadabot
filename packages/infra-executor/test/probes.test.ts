/**
 * probes.test.ts — verification must not be fooled by a 200 error page.
 *
 * Regression test for a real finding (2026-10-26): Charon returns HTTP 200
 * with an "unknown site" body for hosts it does not route. A status-code-only
 * probe reported success on a completely broken route.
 * See ~/muhanai-infra/docs/hot-add-proxy.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecordingRunner } from "../src/runner.ts";
import { DECEPTIVE_OK_MARKERS, verify } from "../src/probes.ts";
import type { InfraAction } from "../src/types.ts";

function act(partial: Partial<InfraAction> & Pick<InfraAction, "id">): InfraAction {
  return { target: "muhanai-vps", ...partial } as InfraAction;
}

test("http.probe accepts a genuine site response", async () => {
  const runner = createRecordingRunner([], { exitCode: 0, stdout: "<html><body>MuhanAI</body></html>" });
  const result = await verify(runner, act({ id: "http.probe", url: "https://muhanai.com/" }));
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /ok/);
});

test("http.probe rejects a 200 carrying Charon's not-configured page", async () => {
  // Exactly what the live server returns for an unrouted host.
  const body = "<!DOCTYPE html><title>Site Not Configured</title><h1>Site Not Configured</h1>";
  const runner = createRecordingRunner([], { exitCode: 0, stdout: body });

  const result = await verify(runner, act({ id: "http.probe", url: "https://infra-test.muhanai.com/" }));
  assert.equal(result.ok, false, "a 200 error page must not count as success");
  assert.match(result.detail, /error page|Site Not Configured/);
});

test("http.probe rejects a transport failure", async () => {
  const runner = createRecordingRunner([], { exitCode: 7, stderr: "Failed to connect" });
  const result = await verify(runner, act({ id: "http.probe", url: "https://nope.invalid/" }));
  assert.equal(result.ok, false);
  assert.match(result.detail, /exit 7|Failed to connect/);
});

test("http.probe issues a body-fetching curl, not a status-only one", async () => {
  const runner = createRecordingRunner([], { exitCode: 0, stdout: "<html>ok</html>" });
  await verify(runner, act({ id: "http.probe", url: "https://muhanai.com/" }));

  const call = runner.calls[0];
  assert.ok(call);
  assert.equal(call.command, "curl");
  assert.ok(!call.argv.includes("/dev/null"), "-o /dev/null would discard the body we need");
  assert.ok(!call.argv.includes("%{http_code}"), "status code alone is insufficient");
});

test("the marker list covers the pages Charon actually serves", () => {
  // Guards against someone trimming this list without checking the server.
  assert.ok(DECEPTIVE_OK_MARKERS.includes("Site Not Configured"));
  assert.ok(DECEPTIVE_OK_MARKERS.includes("unknown.html"));
});

test("health_check still verifies the admin endpoint", async () => {
  const runner = createRecordingRunner([], { exitCode: 0, stdout: '{"status":"ok"}' });
  const result = await verify(runner, act({ id: "health_check" }));
  assert.equal(result.ok, true, result.detail);
  const call = runner.calls[0];
  assert.ok(call?.argv.some((a) => a.includes("8081")), "health_check must hit the Charon admin port");
});
