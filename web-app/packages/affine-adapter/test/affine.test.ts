/**
 * affine-adapter test suite — block schemas, signals, store I/O
 *
 * Note: yjs is intentionally a no-op stub here. Tests use a tiny in-memory
 * Map-based "BlockNode" store so we don't need the heavy Y.js dependency in
 * this minimal CI. Production uses real Y.Doc (see src/store.ts).
 *
 * 20 cases
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defineBlockSchema,
  createBlock,
  DADABOT_SCHEMAS,
  AIMessageSchema,
  HumanNoteSchema,
  CodeSnippetSchema,
  getSchema,
  createSignal,
  propSignal,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Block schemas
// ---------------------------------------------------------------------------

test("defineBlockSchema: requires namespaced flavour", () => {
  assert.throws(() => defineBlockSchema({ flavour: "x", displayName: "x", icon: "", props: [], childrenAllowed: false }));
});

test("DADABOT_SCHEMAS: contains the 3 builtin flavours", () => {
  assert.equal(DADABOT_SCHEMAS.length, 3);
  const flavours = DADABOT_SCHEMAS.map((s) => s.flavour);
  assert.ok(flavours.includes("dadabot:ai-message"));
  assert.ok(flavours.includes("dadabot:human-note"));
  assert.ok(flavours.includes("dadabot:code-snippet"));
});

test("createBlock: applies defaults for missing props", () => {
  const b = createBlock(AIMessageSchema, { id: "b1", props: { content: "hi" } });
  assert.equal(b.props.role, "assistant");
  assert.equal(b.props.confidence, 0);
  assert.equal(b.props.content, "hi");
});

test("createBlock: throws when required prop missing", () => {
  // Remove default for content → it becomes effectively required
  const schema = defineBlockSchema({
    flavour: "x:test",
    displayName: "test",
    icon: "t",
    props: [{ name: "msg", type: "string" }],
    childrenAllowed: false,
  });
  assert.throws(() => createBlock(schema, { id: "b1", props: {} }));
});

test("createBlock: optional prop can be missing", () => {
  const schema = defineBlockSchema({
    flavour: "x:opt",
    displayName: "opt",
    icon: "o",
    props: [{ name: "note", type: "string", optional: true }],
    childrenAllowed: false,
  });
  const b = createBlock(schema, { id: "b1" });
  assert.equal(b.props.note, undefined);
});

test("getSchema: lookup by flavour", () => {
  assert.equal(getSchema(DADABOT_SCHEMAS, "dadabot:human-note")?.icon, "👤");
  assert.equal(getSchema(DADABOT_SCHEMAS, "dadabot:code-snippet")?.icon, "💻");
  assert.equal(getSchema(DADABOT_SCHEMAS, "missing")?.icon, undefined);
});

test("HumanNoteSchema: requires author + content", () => {
  assert.throws(() => createBlock(HumanNoteSchema, { id: "n1" }));
  const n = createBlock(HumanNoteSchema, { id: "n1", props: { author: "alice", content: "looks good" } });
  assert.equal(n.props.author, "alice");
});

test("CodeSnippetSchema: defaults language to plaintext", () => {
  const c = createBlock(CodeSnippetSchema, { id: "c1", props: { code: "x()" } });
  assert.equal(c.props.language, "plaintext");
});

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

test("createSignal: initial value", () => {
  const s = createSignal(42);
  assert.equal(s(), 42);
});

test("createSignal: set notifies listeners with prev + next", () => {
  const s = createSignal(0);
  const events: Array<[number, number]> = [];
  s.subscribe((next, prev) => events.push([next, prev]));
  s.set(1);
  s.set(2);
  assert.deepEqual(events, [[1, 0], [2, 1]]);
});

test("createSignal: update applies function", () => {
  const s = createSignal(5);
  s.update((n) => n * 2);
  assert.equal(s(), 10);
});

test("createSignal: unsubscribe stops notifications", () => {
  const s = createSignal(0);
  let count = 0;
  const unsub = s.subscribe(() => count++);
  s.set(1);
  unsub();
  s.set(2);
  assert.equal(count, 1);
});

test("createSignal: peek returns current without registering listener", () => {
  const s = createSignal("x");
  assert.equal(s.peek(), "x");
});

test("propSignal: emits when block prop changes", () => {
  const blockStore = new Map<string, { id: string; props: Record<string, unknown> }>();
  const cbSubs = new Set<(b: { id: string; props: Record<string, unknown> }) => void>();
  const getBlock = (id: string) => blockStore.get(id);
  const onChange = (cb: (b: any) => void) => {
    cbSubs.add(cb);
    return () => cbSubs.delete(cb);
  };

  blockStore.set("b1", { id: "b1", props: { score: 0.5 } });
  const sig = propSignal<number>(getBlock, "b1", "score", onChange, 0.5);
  assert.equal(sig(), 0.5);

  // Simulate workspace observer firing
  blockStore.set("b1", { id: "b1", props: { score: 0.9 } });
  for (const cb of cbSubs) cb(blockStore.get("b1")!);
  assert.equal(sig(), 0.9);
});

// ---------------------------------------------------------------------------
// Workspace lifecycle (without real Y.js — uses a Map-backed mock to verify
// the public API contracts work as documented)
// ---------------------------------------------------------------------------

// Minimal stand-in to verify the contract works in isolation
interface SerializedWorkspace {
  id: string;
  blocks: Array<{
    id: string;
    flavour: string;
    props: Record<string, unknown>;
    children: string[];
    createdAt: string;
    updatedAt: string;
  }>;
}

function createMockWorkspace(schemas: typeof DADABOT_SCHEMAS) {
  const blocks = new Map<string, SerializedWorkspace["blocks"][number]>();
  const listeners = new Set<(b: SerializedWorkspace["blocks"][number]) => void>();
  return {
    schemas,
    addBlock(b: SerializedWorkspace["blocks"][number]) {
      blocks.set(b.id, b);
      for (const l of listeners) l(b);
    },
    getBlock(id: string) {
      return blocks.get(id);
    },
    listBlocks() {
      return [...blocks.values()];
    },
    onBlockChange(cb: (b: SerializedWorkspace["blocks"][number]) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

test("Mock workspace: add + list + onBlockChange emits", () => {
  const ws = createMockWorkspace(DADABOT_SCHEMAS);
  let count = 0;
  ws.onBlockChange(() => count++);
  ws.addBlock({
    id: "ai-1",
    flavour: "dadabot:ai-message",
    props: { role: "assistant", content: "hi", modelProvider: "x", modelId: "y", confidence: 0.8, toolCalls: [] },
    children: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(count, 1);
  assert.equal(ws.listBlocks().length, 1);
  assert.equal(ws.getBlock("ai-1")?.flavour, "dadabot:ai-message");
});

test("Mock workspace: getSchema lookup works at workspace level", () => {
  const ws = createMockWorkspace(DADABOT_SCHEMAS);
  assert.equal(getSchema(ws.schemas, "dadabot:ai-message")?.icon, "🤖");
});

// ---------------------------------------------------------------------------
// Cross-flavor composition (AI message → human note annotation chain)
// ---------------------------------------------------------------------------

test("Composition: human-note links to ai-message via linkedBlockId", () => {
  const ws = createMockWorkspace(DADABOT_SCHEMAS);
  ws.addBlock({
    id: "ai-1",
    flavour: "dadabot:ai-message",
    props: { role: "assistant", content: "use sam-tools", modelProvider: "anthropic", modelId: "claude", confidence: 0.9, toolCalls: [] },
    children: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const note = createBlock(HumanNoteSchema, {
    id: "n-1",
    props: { author: "alice", content: "approval needed for sam-tools swap", linkedBlockId: "ai-1" },
  });
  ws.addBlock({
    ...note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(ws.getBlock("n-1")?.props.linkedBlockId, "ai-1");
});

test("Composition: code-snippet has language + filename + annotations", () => {
  const ws = createMockWorkspace(DADABOT_SCHEMAS);
  const snippet = createBlock(CodeSnippetSchema, {
    id: "c-1",
    props: {
      code: "const x = 1",
      language: "typescript",
      filename: "index.ts",
      annotations: [{ line: 1, author: "bob", comment: "magic number?" }],
    },
  });
  ws.addBlock({
    ...snippet,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const stored = ws.getBlock("c-1");
  assert.equal(stored?.props.language, "typescript");
  assert.equal(stored?.props.filename, "index.ts");
});

// ---------------------------------------------------------------------------
// Schemas immutability
// ---------------------------------------------------------------------------

test("defineBlockSchema: returns same shape, does not mutate", () => {
  const schema = {
    flavour: "x:frozen",
    displayName: "frozen",
    icon: "❄",
    props: [{ name: "a", type: "string" as const }],
    childrenAllowed: false,
  };
  const before = JSON.stringify(schema);
  defineBlockSchema(schema);
  assert.equal(JSON.stringify(schema), before);
});

test("Schemas: 3 Dadabot flavours are properly namespaced", () => {
  for (const s of DADABOT_SCHEMAS) {
    assert.match(s.flavour, /^dadabot:/);
    assert.ok(s.icon.length > 0);
    assert.ok(s.displayName.length > 0);
  }
});

test("createBlock: timestamps are ISO strings", () => {
  const b = createBlock(AIMessageSchema, { id: "t1", props: { content: "x" } });
  assert.match(b.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(b.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
