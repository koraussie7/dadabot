/**
 * store.ts — Headless BlockSuite-style reactive store (Map-backed).
 *
 * The real implementation uses Y.Doc + Y.Map for CRDT-based conflict-free sync.
 * For Dadabot's first integration we ship a Map-backed equivalent that exposes
 * the SAME API so downstream consumers (UI, tests, persistence) work identically.
 * Upgrading to full Y.js later is a 1-file swap.
 */
import type { BlockSchema, BlockInstance } from "./blocks.js";

export interface WorkspaceOptions {
  id: string;
  schema: BlockSchema[];
  persistence?: "memory" | "indexeddb";
}

export interface Workspace {
  readonly id: string;
  readonly doc: unknown;
  readonly blocks: Map<string, BlockInstance>;
  readonly schemas: BlockSchema[];
  toJSON(): SerializedWorkspace;
  fromJSON(snapshot: SerializedWorkspace): void;
  addBlock(block: BlockInstance): string;
  removeBlock(id: string): void;
  getBlock(id: string): BlockInstance | undefined;
  listBlocks(): BlockInstance[];
  onBlockChange(cb: (block: BlockInstance) => void): () => void;
}

export interface SerializedWorkspace {
  id: string;
  blocks: SerializedBlock[];
}

export interface SerializedBlock {
  id: string;
  flavour: string;
  props: Record<string, unknown>;
  children: string[];
  createdAt: string;
  updatedAt: string;
}

export function createWorkspace(opts: WorkspaceOptions): Workspace {
  const blocks = new Map<string, BlockInstance>();
  const listeners = new Set<(b: BlockInstance) => void>();
  return {
    id: opts.id,
    doc: { type: "mock-ydoc", workspaceId: opts.id },
    blocks,
    schemas: opts.schema,
    toJSON(): SerializedWorkspace {
      return {
        id: opts.id,
        blocks: Array.from(blocks.values()).map((b) => ({
          id: b.id,
          flavour: b.flavour,
          props: { ...b.props },
          children: [...b.children],
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        })),
      };
    },
    fromJSON(snapshot: SerializedWorkspace): void {
      blocks.clear();
      for (const b of snapshot.blocks) {
        blocks.set(b.id, {
          id: b.id,
          flavour: b.flavour,
          props: { ...b.props },
          children: [...b.children],
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        });
      }
    },
    addBlock(block: BlockInstance): string {
      blocks.set(block.id, { ...block, props: { ...block.props } });
      for (const l of listeners) l(block);
      return block.id;
    },
    removeBlock(id: string): void {
      blocks.delete(id);
    },
    getBlock(id: string): BlockInstance | undefined {
      const b = blocks.get(id);
      return b ? { ...b, props: { ...b.props } } : undefined;
    },
    listBlocks(): BlockInstance[] {
      return Array.from(blocks.values()).map((b) => ({
        ...b,
        props: { ...b.props },
      }));
    },
    onBlockChange(cb: (b: BlockInstance) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
