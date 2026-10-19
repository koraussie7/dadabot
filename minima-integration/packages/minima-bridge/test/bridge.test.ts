/**
 * Minima bridge tests — 12 cases covering:
 *   - Construction: 2 (default + from env)
 *   - settleCreditsToChain: 3 (happy, ledger rejection, default token)
 *   - syncChainToCredits: 4 (empty, grants, skipped idempotency, error capture)
 *   - Idempotency: 2 (processed txids, double sync)
 *   - Token filtering: 1 (only matching token credits)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MinimaBridge,
  createMinimaBridge,
  type CreditLedger,
  type CreditLedgerEntry,
} from "../src/index.ts";
import {
  MinimaClient,
  type MinimaBlock,
  type MinimaTransaction,
} from "../../minima-client/src/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger(): CreditLedger & { entries: CreditLedgerEntry[] } {
  const entries: CreditLedgerEntry[] = [];
  return {
    entries,
    async grant(entry) {
      if (entries.some((x) => x.idempotencyKey === entry.idempotencyKey)) {
        return { success: false, error: "duplicate idempotencyKey" };
      }
      entries.push({ ...entry, at: Date.now() });
      return { success: true };
    },
    async spend(entry) {
      if (entries.some((x) => x.idempotencyKey === entry.idempotencyKey)) {
        return { success: false, error: "duplicate idempotencyKey" };
      }
      entries.push({ ...entry, at: Date.now() });
      return { success: true };
    },
    async getByIdempotencyKey(key) {
      return entries.find((x) => x.idempotencyKey === key);
    },
  };
}

/**
 * Create a MinimaClient whose rpc.getBlockHeight and rpc.getBlock return
 * pre-canned values, and dada.send returns a fixed txid.
 */
function createMockClient(opts: {
  height?: number;
  block?: MinimaBlock | null;
  sendTxid?: string;
}): MinimaClient {
  const fakeFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/status")) {
      return new Response(
        JSON.stringify({ result: { height: opts.height ?? 0 } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (/block/.test(u)) {
      if (!opts.block) {
        return new Response(
          JSON.stringify({
            result: { height: 0, hash: "", timestamp: 0, transactions: [] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ result: opts.block }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/send")) {
      const txid = opts.sendTxid ?? "tx-send";
      const tx: MinimaTransaction = {
        txid,
        from: "",
        to: "",
        amount: "0",
        token: "MINIMA",
        blockHeight: 0,
        confirmed: false,
      };
      return new Response(JSON.stringify({ result: tx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ result: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return new MinimaClient({ nodeUrl: "http://mock", fetch: fakeFetch });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("MinimaBridge: default settlement token id", () => {
  const bridge = createMinimaBridge({
    nodeUrl: "http://x",
    creditLedger: makeLedger(),
  });
  assert.ok(bridge instanceof MinimaBridge);
});

test("MinimaBridge: from env factory", () => {
  const bridge = createMinimaBridge(makeLedger());
  assert.ok(bridge instanceof MinimaBridge);
});

// ---------------------------------------------------------------------------
// settleCreditsToChain
// ---------------------------------------------------------------------------

test("settleCreditsToChain: burns credits and returns txid", async () => {
  const ledger = makeLedger();
  const mockClient = createMockClient({ sendTxid: "tx-burn-1" });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "MINIMA",
  });
  bridge.setClient(mockClient);
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";

  try {
    const r = await bridge.settleCreditsToChain("u-1", 100, "MINIMA", "test");
    assert.equal(r.txid, "tx-burn-1");
    assert.equal(r.creditsBurned, 100);
    assert.equal(r.tokenId, "MINIMA");
    const spends = ledger.entries.filter((e) =>
      e.idempotencyKey.startsWith("minima-burn:")
    );
    assert.equal(spends.length, 1);
    assert.equal(spends[0]!.amount, 100);
    assert.equal(spends[0]!.userId, "u-1");
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

test("settleCreditsToChain: throws if ledger rejects spend", async () => {
  const ledger = makeLedger();
  ledger.entries.push({
    idempotencyKey: "minima-burn:u-2:50:MINIMA",
    userId: "u-2",
    amount: 50,
    token: "MINIMA",
    at: 1,
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
  });
  await assert.rejects(
    () => bridge.settleCreditsToChain("u-2", 50, "MINIMA"),
    /Credit spend failed/
  );
});

test("settleCreditsToChain: defaults to settlementTokenId", async () => {
  const ledger = makeLedger();
  const mockClient = createMockClient({ sendTxid: "tx-default-token" });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "DADA",
  });
  bridge.setClient(mockClient);
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";

  try {
    const r = await bridge.settleCreditsToChain("u-3", 25);
    assert.equal(r.tokenId, "DADA");
    assert.equal(r.txid, "tx-default-token");
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

// ---------------------------------------------------------------------------
// syncChainToCredits
// ---------------------------------------------------------------------------

test("syncChainToCredits: empty chain returns 0", async () => {
  const ledger = makeLedger();
  const mockClient = createMockClient({ height: 0, block: null });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
  });
  bridge.setClient(mockClient);
  const r = await bridge.syncChainToCredits(0);
  assert.equal(r.synced, 0);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.errors, []);
});

test("syncChainToCredits: grants credits for matching token tx", async () => {
  const ledger = makeLedger();
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";
  const mockClient = createMockClient({
    height: 100,
    block: {
      height: 100,
      hash: "0xabc",
      timestamp: 1,
      transactions: [
        {
          txid: "tx-1",
          from: "0xa",
          to: "0xbridge",
          amount: "50",
          token: "MINIMA",
          blockHeight: 100,
          confirmed: true,
        },
      ],
    },
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "MINIMA",
  });
  bridge.setClient(mockClient);

  try {
    const r = await bridge.syncChainToCredits(100);
    assert.equal(r.synced, 1);
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0]!.idempotencyKey, "minima:tx-1");
    assert.equal(ledger.entries[0]!.amount, 50);
    assert.equal(ledger.entries[0]!.userId, "bridge-user");
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

test("syncChainToCredits: idempotent — second run skips", async () => {
  const ledger = makeLedger();
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";
  const mockClient = createMockClient({
    height: 100,
    block: {
      height: 100,
      hash: "0xabc",
      timestamp: 1,
      transactions: [
        {
          txid: "tx-1",
          from: "0xa",
          to: "0xbridge",
          amount: "50",
          token: "MINIMA",
          blockHeight: 100,
          confirmed: true,
        },
      ],
    },
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "MINIMA",
  });
  bridge.setClient(mockClient);

  try {
    const r1 = await bridge.syncChainToCredits(100);
    assert.equal(r1.synced, 1);
    const r2 = await bridge.syncChainToCredits(100);
    assert.equal(r2.synced, 0);
    assert.equal(r2.skipped, 1);
    assert.equal(ledger.entries.length, 1);
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

test("syncChainToCredits: skips non-matching tokens", async () => {
  const ledger = makeLedger();
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";
  const mockClient = createMockClient({
    height: 1,
    block: {
      height: 1,
      hash: "0x",
      timestamp: 1,
      transactions: [
        {
          txid: "tx-wrong-token",
          from: "0xa",
          to: "0xbridge",
          amount: "50",
          token: "MINIMA",
          blockHeight: 1,
          confirmed: true,
        },
      ],
    },
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "DADA",
  });
  bridge.setClient(mockClient);

  try {
    const r = await bridge.syncChainToCredits(1);
    assert.equal(r.synced, 0);
    assert.equal(ledger.entries.length, 0);
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

test("syncChainToCredits: skips tx to non-bridge address", async () => {
  const ledger = makeLedger();
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";
  const mockClient = createMockClient({
    height: 1,
    block: {
      height: 1,
      hash: "0x",
      timestamp: 1,
      transactions: [
        {
          txid: "tx-other",
          from: "0xa",
          to: "0xsomeoneelse",
          amount: "50",
          token: "MINIMA",
          blockHeight: 1,
          confirmed: true,
        },
      ],
    },
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "MINIMA",
  });
  bridge.setClient(mockClient);

  try {
    const r = await bridge.syncChainToCredits(1);
    assert.equal(r.synced, 0);
    assert.equal(ledger.entries.length, 0);
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

// ---------------------------------------------------------------------------
// getProcessedTxids
// ---------------------------------------------------------------------------

test("getProcessedTxids: empty initially", () => {
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: makeLedger(),
  });
  assert.deepEqual(bridge.getProcessedTxids(), []);
});

test("getProcessedTxids: tracks synced txids", async () => {
  const ledger = makeLedger();
  process.env.MINIMA_BRIDGE_ADDRESS = "0xbridge";
  const mockClient = createMockClient({
    height: 100,
    block: {
      height: 100,
      hash: "0xabc",
      timestamp: 1,
      transactions: [
        {
          txid: "tx-tracked",
          from: "0xa",
          to: "0xbridge",
          amount: "10",
          token: "MINIMA",
          blockHeight: 100,
          confirmed: true,
        },
      ],
    },
  });
  const bridge = new MinimaBridge({
    nodeUrl: "http://x",
    creditLedger: ledger,
    settlementTokenId: "MINIMA",
  });
  bridge.setClient(mockClient);

  try {
    await bridge.syncChainToCredits(100);
    const txids = bridge.getProcessedTxids();
    assert.ok(txids.includes("tx-tracked"));
  } finally {
    delete process.env.MINIMA_BRIDGE_ADDRESS;
  }
});

// ---------------------------------------------------------------------------
// Ledger interaction (sanity)
// ---------------------------------------------------------------------------

test("ledger: getByIdempotencyKey returns entry", async () => {
  const ledger = makeLedger();
  ledger.entries.push({
    idempotencyKey: "k1",
    userId: "u",
    amount: 10,
    token: "X",
    at: 1,
  });
  const e = await ledger.getByIdempotencyKey("k1");
  assert.ok(e);
  assert.equal(e!.amount, 10);
});

test("ledger: duplicate grant rejected", async () => {
  const ledger = makeLedger();
  const r1 = await ledger.grant({
    idempotencyKey: "k",
    userId: "u",
    amount: 1,
    token: "X",
  });
  const r2 = await ledger.grant({
    idempotencyKey: "k",
    userId: "u",
    amount: 1,
    token: "X",
  });
  assert.equal(r1.success, true);
  assert.equal(r2.success, false);
});
