// openwork-client.test.ts — Exercises the browser client against the live server.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../../server/server.ts";
import { store } from "../../server/store.ts";
import { OpenWorkClient, defaultClient, localhostClient } from "./openwork-client.ts";

let baseUrl = "";
let serverHandle: import("node:http").Server | null = null;

before(async () => {
  const h = await startServer(0, "127.0.0.1");
  serverHandle = h.server;
  baseUrl = h.url;
  store.reset();
});

after(() => {
  serverHandle?.close();
});

function client() {
  return new OpenWorkClient(baseUrl);
}

test("health() returns ts", async () => {
  const r = await client().health();
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.ts > 0);
});

test("register() creates agent", async () => {
  const r = await client().register({
    wallet: "0x5555555555555555555555555555555555555555",
    name: "browser-agent",
    modelProvider: "groq",
    modelId: "llama-3.3-70b",
    capabilities: ["code-edit"],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.created, true);
    assert.equal(r.agent.name, "browser-agent");
  }
});

test("register() returns err response on bad wallet", async () => {
  const r = await client().register({
    wallet: "nope",
    name: "x",
    modelProvider: "y",
    modelId: "z",
    capabilities: [],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "invalid_wallet");
});

test("listAgents() returns array", async () => {
  const r = await client().listAgents();
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(Array.isArray(r.agents));
});

test("full task lifecycle via client", async () => {
  const c = client();

  const reg = await c.register({
    wallet: "0x6666666666666666666666666666666666666666",
    name: "lifecycle-agent",
    modelProvider: "anthropic",
    modelId: "claude-sonnet-4.5",
    capabilities: ["refactor", "code-edit"],
  });
  assert.equal(reg.ok, true);
  if (!reg.ok) return;

  const created = await c.createTask({
    title: "refactor findpage",
    description: "switch to free models",
    capability: "refactor",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const claim = await c.claimTask(created.task.id, reg.agent.id);
  assert.equal(claim.ok, true);
  if (!claim.ok) return;
  assert.equal(claim.task.status, "claimed");

  const sub = await c.submitTask(created.task.id, reg.agent.id, "https://github.com/x/y/pull/1");
  assert.equal(sub.ok, true);
  if (!sub.ok) return;
  assert.equal(sub.task.status, "submitted");

  const dec = await c.decideTask(created.task.id, "approved");
  assert.equal(dec.ok, true);
  if (!dec.ok) return;
  assert.equal(dec.task.status, "approved");

  const rep = await c.getReputation(reg.agent.id);
  assert.equal(rep.ok, true);
  if (rep.ok) assert.ok(rep.score >= 1);
});

test("fetchSkillMd returns markdown text", async () => {
  const md = await client().fetchSkillMd();
  if (typeof md !== "string") {
    assert.fail("expected string");
    return;
  }
  assert.match(md, /Self-Registration/);
});

test("defaultClient + localhostClient factories", () => {
  const d = defaultClient();
  const l = localhostClient();
  assert.equal(d.baseUrl, "https://muhanai.com");
  assert.match(l.baseUrl, /^http:\/\/127\.0\.0\.1:/);
});

test("isErrResponse narrows union correctly", async () => {
  const r = await client().register({
    wallet: "still-bad",
    name: "x",
    modelProvider: "y",
    modelId: "z",
    capabilities: [],
  });
  // r is narrowed when ok=false
  if (!r.ok) {
    assert.equal(typeof r.error.code, "string");
    assert.equal(typeof r.error.message, "string");
  }
});
