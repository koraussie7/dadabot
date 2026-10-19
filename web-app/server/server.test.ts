// server.test.ts — Vitest tests for the OpenWork-compatible agent registry.
//
// Covers all 11 endpoints + edge cases. Uses an ephemeral port.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.ts";
import { store } from "./store.ts";

let baseUrl = "";
let serverHandle: { server: import("node:http").Server; url: string }["server"] = null as never;

before(async () => {
  const handle = await startServer(0, "127.0.0.1"); // 0 = ephemeral port
  serverHandle = handle.server;
  baseUrl = handle.url;
});

after(() => {
  serverHandle?.close();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

before(() => {
  store.reset();
});

describe("health + skill.md", () => {
  test("GET /health returns ok", async () => {
    const r = await call("GET", "/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.ts > 0);
  });

  test("GET /skill.md returns markdown protocol description", async () => {
    const res = await fetch(`${baseUrl}/skill.md`);
    const text = await res.text();
    assert.match(text, /Self-Registration/);
    assert.match(text, /\/api\/agents\/register/);
  });
});

describe("agent registration", () => {
  test("POST /api/agents/register creates new agent", async () => {
    const r = await call("POST", "/api/agents/register", {
      wallet: "0x1234567890123456789012345678901234567890",
      name: "test-agent-1",
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4.5",
      capabilities: ["code-edit", "refactor"],
      tools: 186,
      freeModels: 6,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.created, true);
    assert.match(r.body.agent.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.body.agent.wallet, "0x1234567890123456789012345678901234567890");
    assert.equal(r.body.agent.reputation.score, 0);
    assert.equal(r.body.agent.credential.issuer, "did:ethr:0x1234567890123456789012345678901234567890");
  });

  test("POST /api/agents/register upserts on same wallet", async () => {
    const wallet = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const r1 = await call("POST", "/api/agents/register", {
      wallet,
      name: "v1",
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4.5",
      capabilities: ["code-edit"],
    });
    assert.equal(r1.status, 201);
    const id1 = r1.body.agent.id;

    const r2 = await call("POST", "/api/agents/register", {
      wallet,
      name: "v2",
      modelProvider: "groq",
      modelId: "llama-3.3-70b",
      capabilities: ["code-edit", "refactor"],
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.created, false);
    assert.equal(r2.body.agent.id, id1, "id preserved on upsert");
    assert.equal(r2.body.agent.name, "v2", "mutable fields updated");
    assert.equal(r2.body.agent.modelProvider, "groq");
    assert.deepEqual(r2.body.agent.capabilities, ["code-edit", "refactor"]);
  });

  test("POST /api/agents/register rejects bad wallet", async () => {
    const r = await call("POST", "/api/agents/register", {
      wallet: "not-hex",
      name: "x",
      modelProvider: "y",
      modelId: "z",
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "invalid_wallet");
  });

  test("POST /api/agents/register rejects unknown capability", async () => {
    const r = await call("POST", "/api/agents/register", {
      wallet: "0x1111111111111111111111111111111111111111",
      name: "x",
      modelProvider: "y",
      modelId: "z",
      capabilities: ["hack-the-planet"],
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "invalid_capability");
  });

  test("POST /api/agents/register accepts SIWE message with matching wallet", async () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const message = `muhanai.com wants you to sign in with your Ethereum account:\n${wallet}\n\nI accept the Muhanai Agent OS Terms of Service.\n\nURI: https://muhanai.com\nVersion: 1\nIssuedAt: ${new Date().toISOString()}\nNonce: abc123`;
    const r = await call("POST", "/api/agents/register", {
      wallet,
      name: "siwe-agent",
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4.5",
      capabilities: ["code-edit"],
      message,
      signature: "0xfake",
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.agent.credential.issuer, `did:ethr:${wallet}`);
  });

  test("POST /api/agents/register rejects SIWE with mismatched wallet", async () => {
    const message = `muhanai.com wants you to sign in with your Ethereum account:\n0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n\nIssuedAt: ${new Date().toISOString()}`;
    const r = await call("POST", "/api/agents/register", {
      wallet: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      name: "x",
      modelProvider: "y",
      modelId: "z",
      capabilities: ["code-edit"],
      message,
      signature: "0xfake",
    });
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, "siwe_wallet_mismatch");
  });
});

describe("agent listing + lookup", () => {
  test("GET /api/agents returns all agents", async () => {
    const r = await call("GET", "/api/agents");
    assert.equal(r.status, 200);
    assert.ok(r.body.agents.length >= 1);
  });

  test("GET /api/agents/:id returns single agent", async () => {
    const list = await call("GET", "/api/agents");
    const id = list.body.agents[0].id;
    const r = await call("GET", `/api/agents/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.agent.id, id);
  });

  test("GET /api/agents/missing returns 404", async () => {
    const r = await call("GET", "/api/agents/00000000-0000-0000-0000-000000000000");
    assert.equal(r.status, 404);
  });
});

describe("task lifecycle", () => {
  let agentId = "";

  before(async () => {
    const r = await call("POST", "/api/agents/register", {
      wallet: "0x3333333333333333333333333333333333333333",
      name: "worker",
      modelProvider: "groq",
      modelId: "llama-3.3-70b",
      capabilities: ["code-edit", "refactor", "doc-generation"],
    });
    agentId = r.body.agent.id;
  });

  test("POST /api/tasks creates a task", async () => {
    const r = await call("POST", "/api/tasks", {
      title: "Refactor FindPage",
      description: "Switch to free models",
      capability: "refactor",
      reward: 3,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.task.status, "open");
    assert.match(r.body.task.id, /^[0-9a-f-]{36}$/);
  });

  test("GET /api/tasks filters by status and capability", async () => {
    const r = await call("GET", "/api/tasks?status=open&capability=refactor");
    assert.equal(r.status, 200);
    for (const t of r.body.tasks) {
      assert.equal(t.status, "open");
      assert.equal(t.capability, "refactor");
    }
  });

  test("POST /api/tasks/:id/claim assigns to matching capability agent", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const r = await call("POST", `/api/tasks/${created.body.task.id}/claim`, { agentId });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.status, "claimed");
    assert.equal(r.body.task.claimedBy, agentId);
  });

  test("claim rejects agent without matching capability", async () => {
    // create an agent that only knows code-edit
    const reg = await call("POST", "/api/agents/register", {
      wallet: "0x4444444444444444444444444444444444444444",
      name: "limited",
      modelProvider: "anthropic",
      modelId: "haiku",
      capabilities: ["code-edit"],
    });
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "research",
    });
    const r = await call("POST", `/api/tasks/${created.body.task.id}/claim`, {
      agentId: reg.body.agent.id,
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "capability_mismatch");
  });

  test("claim twice → second call rejected with task_status_claimed", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const a = await call("POST", `/api/tasks/${created.body.task.id}/claim`, { agentId });
    assert.equal(a.status, 200);
    const b = await call("POST", `/api/tasks/${created.body.task.id}/claim`, { agentId });
    assert.equal(b.status, 409);
    assert.match(b.body.error.code, /task_status/);
  });

  test("submit + approve increments reputation", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const taskId = created.body.task.id;
    await call("POST", `/api/tasks/${taskId}/claim`, { agentId });
    const sub = await call("POST", `/api/tasks/${taskId}/submit`, {
      agentId,
      prUrl: "https://github.com/foo/bar/pull/1",
    });
    assert.equal(sub.status, 200);
    assert.equal(sub.body.task.status, "submitted");

    const dec = await call("POST", `/api/tasks/${taskId}/decide`, { decision: "approved" });
    assert.equal(dec.status, 200);
    assert.equal(dec.body.task.status, "approved");

    const rep = await call("GET", `/api/agents/${agentId}/reputation`);
    assert.equal(rep.status, 200);
    assert.ok(rep.body.score >= 1);
    const kinds = rep.body.events.map((e: any) => e.kind);
    assert.ok(kinds.includes("successful_completion"));
  });

  test("submit + reject decrements reputation", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const taskId = created.body.task.id;
    await call("POST", `/api/tasks/${taskId}/claim`, { agentId });
    await call("POST", `/api/tasks/${taskId}/submit`, {
      agentId,
      prUrl: "https://github.com/foo/bar/pull/2",
    });
    await call("POST", `/api/tasks/${taskId}/decide`, { decision: "rejected" });

    const rep = await call("GET", `/api/agents/${agentId}/reputation`);
    const scoreAfter = rep.body.score;
    assert.ok(scoreAfter <= -5 + 10, `expected score ≤ 5 after one rejection, got ${scoreAfter}`);
    // At least one human_revoked event
    const kinds = rep.body.events.map((e: any) => e.kind);
    assert.ok(kinds.includes("human_revoked"));
  });

  test("decide on open task rejected", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const r = await call("POST", `/api/tasks/${created.body.task.id}/decide`, { decision: "approved" });
    assert.equal(r.status, 409);
  });

  test("invalid decision value rejected", async () => {
    const created = await call("POST", "/api/tasks", {
      title: "x",
      description: "y",
      capability: "refactor",
    });
    const taskId = created.body.task.id;
    await call("POST", `/api/tasks/${taskId}/claim`, { agentId });
    await call("POST", `/api/tasks/${taskId}/submit`, {
      agentId,
      prUrl: "https://x",
    });
    const r = await call("POST", `/api/tasks/${taskId}/decide`, { decision: "maybe" });
    assert.equal(r.status, 400);
  });
});

describe("edge cases", () => {
  test("unknown route returns 404", async () => {
    const r = await call("GET", "/no/such/path");
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, "not_found");
  });

  test("invalid JSON body returns 400 invalid_json", async () => {
    const res = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "invalid_json");
  });

  test("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});
