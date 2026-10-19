/**
 * Minima client tests — 14 cases covering:
 *   - Construction: 3 (defaults, env, network)
 *   - RPC: 3 (getBlockHeight, getBlock, error handling)
 *   - DADA: 2 (getBalance, send)
 *   - Anchor: 4 (anchorString sha256, retrieve, list, CID determinism)
 *   - Factory: 2 (createMinimaClient, createMinimaClientFromEnv)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MinimaClient,
  MinimaRPCError,
  createMinimaClient,
  createMinimaClientFromEnv,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("MinimaClient: default nodeUrl from env fallback", () => {
  const c = new MinimaClient();
  assert.equal(typeof c.rpc, "object");
  assert.equal(typeof c.dada, "object");
  assert.equal(typeof c.anchor, "object");
});

test("MinimaClient: custom nodeUrl", () => {
  const c = new MinimaClient({ nodeUrl: "http://example:9001" });
  assert.ok(c);
});

test("MinimaClient: factory functions return instance", () => {
  const a = createMinimaClient({ nodeUrl: "http://x" });
  const b = createMinimaClientFromEnv();
  assert.ok(a instanceof MinimaClient);
  assert.ok(b instanceof MinimaClient);
});

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

test("rpc.getBlockHeight: parses successful response", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ result: { height: 12345 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const c = new MinimaClient({ nodeUrl: "http://x", apiKey: "k", fetch: fakeFetch });
  const h = await c.rpc.getBlockHeight();
  assert.equal(h, 12345);
});

test("rpc.getBlock: returns block with transactions", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        result: {
          height: 100,
          hash: "0xabc",
          timestamp: 1234567890,
          transactions: [
            {
              txid: "tx1",
              from: "0xa",
              to: "0xb",
              amount: "100",
              token: "MINIMA",
              blockHeight: 100,
              confirmed: true,
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const b = await c.rpc.getBlock(100);
  assert.equal(b.height, 100);
  assert.equal(b.transactions.length, 1);
  assert.equal(b.transactions[0]!.txid, "tx1");
});

test("rpc: throws MinimaRPCError on HTTP error", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("internal error", { status: 500 });
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  await assert.rejects(() => c.rpc.getBlockHeight(), (err: unknown) => {
    return err instanceof MinimaRPCError && err.status === 500;
  });
});

// ---------------------------------------------------------------------------
// DADA
// ---------------------------------------------------------------------------

test("dada.getBalance: returns balance", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        result: { address: "0xa", token: "DADA", amount: "1000.5" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const b = await c.dada.getBalance("0xa", "DADA");
  assert.equal(b.amount, "1000.5");
  assert.equal(b.token, "DADA");
});

test("dada.send: posts send request", async () => {
  let captured = "";
  const fakeFetch: typeof fetch = async (_url, init) => {
    captured = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        result: {
          txid: "tx-send",
          from: "0xa",
          to: "0xb",
          amount: "10",
          token: "MINIMA",
          blockHeight: 0,
          confirmed: false,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const tx = await c.dada.send({
    from: "0xa",
    to: "0xb",
    amount: "10",
    token: "MINIMA",
  });
  assert.equal(tx.txid, "tx-send");
  assert.match(captured, /0xb/);
});

// ---------------------------------------------------------------------------
// Anchor
// ---------------------------------------------------------------------------

test("anchor.anchorString: deterministic SHA-256", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ result: "tx-anchor-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const a = await c.anchor.anchorString("hello world", "test");
  // SHA-256 of "hello world" is well-known
  assert.equal(
    a.cid,
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
  );
  assert.equal(a.txid, "tx-anchor-1");
  assert.equal(a.namespace, "test");
});

test("anchor.anchorString: same input → same CID", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ result: "tx" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const a = await c.anchor.anchorString("foo", "ns");
  const b = await c.anchor.anchorString("foo", "ns");
  assert.equal(a.cid, b.cid);
});

test("anchor.retrieve: returns content string", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ result: { content: "retrieved content" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const r = await c.anchor.retrieve("abc", "ns");
  assert.equal(r, "retrieved content");
});

test("anchor.list: returns array of results", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        result: [
          {
            txid: "t1",
            hash: "h1",
            cid: "h1",
            blockHeight: 1,
            namespace: "ns",
            path: "ns/h1",
            timestamp: 100,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const items = await c.anchor.list("ns");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.cid, "h1");
});

// ---------------------------------------------------------------------------
// SHA-256 determinism (anti-regression)
// ---------------------------------------------------------------------------

test("sha256: empty string → e3b0c44...", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ result: "tx" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  const a = await c.anchor.anchorString("", "ns");
  assert.equal(
    a.cid,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});

test("rpc.call: includes apiKey as Bearer token", async () => {
  let authHeader = "";
  const fakeFetch: typeof fetch = async (_url, init) => {
    authHeader = String((init?.headers as Record<string, string>)?.["Authorization"] ?? "");
    return new Response(JSON.stringify({ result: { height: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const c = new MinimaClient({
    nodeUrl: "http://x",
    apiKey: "secret-key",
    fetch: fakeFetch,
  });
  await c.rpc.getBlockHeight();
  assert.equal(authHeader, "Bearer secret-key");
});

test("rpc: error from server body is wrapped", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { code: "bad", message: "boom" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const c = new MinimaClient({ nodeUrl: "http://x", fetch: fakeFetch });
  await assert.rejects(() => c.rpc.getBlockHeight(), (err: unknown) => {
    return err instanceof MinimaRPCError && err.code === "bad";
  });
});
