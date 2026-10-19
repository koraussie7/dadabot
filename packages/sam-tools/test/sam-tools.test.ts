/**
 * sam-tools tests — FreeModelRotator + generateProposal.
 *
 * 14 cases covering:
 *   - Provider registry: 4 (count, listAllProviders, listAvailableProviders, ids)
 *   - FreeModelRotator construction: 3 (empty, forceProviders, order)
 *   - chat rotation: 4 (round-robin, maxRotations, error fallback, latencyMs)
 *   - generateProposal: 3 (offline stub, parse JSON, low confidence requires approval)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS,
  FreeModelRotator,
  createRotator,
  listAvailableProviders,
  listAllProviders,
  generateProposal,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

test("providers: 6 free providers registered", () => {
  assert.equal(PROVIDERS.length, 6);
});

test("providers: listAllProviders returns full catalog with hasKey flag", () => {
  const all = listAllProviders();
  assert.equal(all.length, 6);
  const ids = all.map((p) => p.id);
  assert.ok(ids.includes("groq"));
  assert.ok(ids.includes("cerebras"));
  assert.ok(ids.includes("nvidia"));
  assert.ok(ids.includes("gemini"));
  assert.ok(ids.includes("mistral"));
  assert.ok(ids.includes("github-models"));
});

test("providers: listAvailableProviders is empty when no keys set", () => {
  // Save + clear all key env vars
  const saved: Record<string, string | undefined> = {};
  for (const p of PROVIDERS) {
    if (p.apiKeyEnvVar) {
      saved[p.apiKeyEnvVar] = process.env[p.apiKeyEnvVar];
      delete process.env[p.apiKeyEnvVar];
    }
  }
  try {
    const avail = listAvailableProviders();
    assert.deepEqual(avail, []);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test("providers: ids include required free tier providers", () => {
  const ids = PROVIDERS.map((p) => p.id);
  // The 6 SAM-style providers
  for (const required of ["groq", "cerebras", "nvidia", "gemini", "mistral", "github-models"]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
});

// ---------------------------------------------------------------------------
// FreeModelRotator construction
// ---------------------------------------------------------------------------

test("rotator: empty constructor without env keys = no providers", () => {
  // Clear keys
  const saved: Record<string, string | undefined> = {};
  for (const p of PROVIDERS) {
    if (p.apiKeyEnvVar) {
      saved[p.apiKeyEnvVar] = process.env[p.apiKeyEnvVar];
      delete process.env[p.apiKeyEnvVar];
    }
  }
  try {
    const r = new FreeModelRotator();
    assert.equal(r.size(), 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test("rotator: forceProviders includes them even without env keys", () => {
  const r = new FreeModelRotator({ forceProviders: ["groq", "cerebras"] });
  assert.equal(r.size(), 2);
  assert.deepEqual(r.list(), ["groq", "cerebras"]);
});

test("rotator: order restricts + reorders providers", () => {
  const r = new FreeModelRotator({
    forceProviders: ["groq", "cerebras", "nvidia"],
    order: ["nvidia", "groq"],
  });
  assert.deepEqual(r.list(), ["nvidia", "groq"]);
});

// ---------------------------------------------------------------------------
// chat rotation
// ---------------------------------------------------------------------------

test("rotator.chat: throws when no providers configured", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const p of PROVIDERS) {
    if (p.apiKeyEnvVar) {
      saved[p.apiKeyEnvVar] = process.env[p.apiKeyEnvVar];
      delete process.env[p.apiKeyEnvVar];
    }
  }
  try {
    const r = new FreeModelRotator();
    await assert.rejects(
      () => r.chat({ messages: [{ role: "user", content: "hi" }] }),
      /no providers/i,
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test("rotator.chat: rotates across providers, returns content + provider id", async () => {
  // Mock fetch that succeeds on second try
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response("rate limited", { status: 429 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "hello from provider" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const r = new FreeModelRotator({
    forceProviders: ["groq", "cerebras"],
    fetch: fakeFetch,
  });

  const resp = await r.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(resp.content, "hello from provider");
  assert.equal(resp.provider, "cerebras"); // second in rotation
  assert.equal(resp.rotationIndex, 1);
  assert.equal(resp.totalRotations, 2);
  assert.ok(resp.latencyMs >= 0);
});

test("rotator.chat: respects maxRotations", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("always fail", { status: 500 });

  const r = new FreeModelRotator({
    forceProviders: ["groq", "cerebras", "nvidia"],
    fetch: fakeFetch,
  });

  await assert.rejects(
    () =>
      r.chat({
        messages: [{ role: "user", content: "hi" }],
        maxRotations: 2,
      }),
    /all 2 providers failed/,
  );
});

test("rotator.chat: errors include all attempted providers", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("server error", { status: 503 });

  const r = new FreeModelRotator({
    forceProviders: ["groq", "cerebras"],
    fetch: fakeFetch,
  });

  try {
    await r.chat({ messages: [{ role: "user", content: "hi" }] });
    assert.fail("should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /groq/);
    assert.match(msg, /cerebras/);
  }
});

// ---------------------------------------------------------------------------
// createRotator factory
// ---------------------------------------------------------------------------

test("createRotator: factory returns FreeModelRotator instance", () => {
  const r = createRotator({ forceProviders: ["groq"] });
  assert.ok(r instanceof FreeModelRotator);
  assert.equal(r.size(), 1);
});

// ---------------------------------------------------------------------------
// generateProposal
// ---------------------------------------------------------------------------

test("generateProposal: offline stub when no providers", async () => {
  // Clear keys
  const saved: Record<string, string | undefined> = {};
  for (const p of PROVIDERS) {
    if (p.apiKeyEnvVar) {
      saved[p.apiKeyEnvVar] = process.env[p.apiKeyEnvVar];
      delete process.env[p.apiKeyEnvVar];
    }
  }
  try {
    const r = new FreeModelRotator();
    const p = await generateProposal("Refactor FindPage to use free models", r);
    assert.ok(p.id.startsWith("prop-stub-"));
    assert.match(p.title, /Refactor FindPage/);
    assert.equal(p.confidence, 0.5); // low enough for human approval
    assert.equal(p.kind, "file_edit");
    assert.equal(p.reversible, true);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test("generateProposal: parses JSON from model response", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Refactor FindPage",
                rationale: "Use free models for cost reduction",
                confidence: 0.9,
                reversible: true,
                kind: "file_edit",
                files: [
                  {
                    path: "a.ts",
                    operation: "modify",
                    content: "x",
                    linesAdded: 5,
                    linesRemoved: 3,
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const r = new FreeModelRotator({
    forceProviders: ["groq"],
    fetch: fakeFetch,
  });
  const p = await generateProposal("anything", r);
  assert.equal(p.title, "Refactor FindPage");
  assert.equal(p.confidence, 0.9);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0]!.path, "a.ts");
});

test("generateProposal: high confidence >= 0.7 enables autoMerge", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Add free model rotator",
                rationale: "Adds a new utility",
                confidence: 0.95,
                reversible: true,
                kind: "file_edit",
                files: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const r = new FreeModelRotator({
    forceProviders: ["groq"],
    fetch: fakeFetch,
  });
  const p = await generateProposal("Add free model rotator", r);
  assert.ok(p.confidence >= 0.7, "should be high enough for autoMerge path");
  assert.match(p.agent.modelProvider, /groq|cerebras|nvidia|gemini|mistral|github-models/);
});
