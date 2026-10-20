/**
 * store.ts — Headless BlockSuite-style reactive store (Y.js CRDT-backed).
 * 
 * Real implementation uses Y.Doc + Y.Map for CRDT-based conflict-free sync.
 * API is identical to the Map-backed version for seamless upgrade.
 */
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import * as awarenessProtocol from "y-protocols/awareness.js";
import { WebsocketProvider } from "y-websocket";
import { type BlockInstance, type BlockSchema } from "./blocks.ts";

export type { BlockInstance };
export type { BlockSchema };

export interface WorkspaceOptions {
  id: string;
  schema: BlockSchema[];
  persistence?: "memory" | "indexeddb";
  websocketUrl?: string; // y-websocket server URL (e.g. "wss://sync.dadabot.dev")
  awareness?: boolean; // cursor/selection sharing
}

export interface Workspace {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly blocks: Y.Map<BlockInstance>;
  readonly schemas: BlockSchema[];
  readonly awareness?: awarenessProtocol.Awareness;
  toJSON(): SerializedWorkspace;
  fromJSON(snapshot: SerializedWorkspace): void;
  addBlock(block: BlockInstance): string;
  removeBlock(id: string): void;
  getBlock(id: string): BlockInstance | undefined;
  listBlocks(): BlockInstance[];
  onBlockChange(cb: (block: BlockInstance) => void): () => void;
  destroy(): void;
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

function blockToSerializable(b: BlockInstance): SerializedBlock {
  return {
    id: b.id,
    flavour: b.flavour,
    props: { ...b.props },
    children: [...b.children],
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function serializableToBlock(s: SerializedBlock): BlockInstance {
  return {
    id: s.id,
    flavour: s.flavour,
    props: { ...s.props },
    children: [...s.children],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function createWorkspace(opts: WorkspaceOptions): Workspace {
  const ydoc = new Y.Doc();
  const blocks = ydoc.getMap<BlockInstance>(`${opts.id}:blocks`);
  const schemas = opts.schema;
  const listeners = new Set<(b: BlockInstance) => void>();

  // Awareness (cursor/selection sharing)
  let awareness: awarenessProtocol.Awareness | undefined;
  if (opts.awareness) {
    awareness = new awarenessProtocol.Awareness(ydoc);
    awareness.setLocalState({ user: { name: "user", color: "#" + Math.floor(Math.random() * 16777215).toString(16) } });
  }

  // WebSocket provider (multi-device sync)
  let wsProvider: WebsocketProvider | null = null;
  if (opts.websocketUrl) {
    wsProvider = new WebsocketProvider(opts.websocketUrl, opts.id, ydoc, {
      connect: true,
      maxBackoffTime: 10000,
      awareness: opts.awareness ? awareness : undefined,
    });
    wsProvider.on("status", (event: { status: string }) => {
      console.log("[y-websocket] " + event.status);
    });
    wsProvider.on("sync", (isSynced: boolean) => {
      console.log("[y-websocket] " + (isSynced ? "synced" : "unsynced"));
    });
    if (opts.awareness) {
      wsProvider.awareness = awareness!;
    }
  }

  // IndexedDB persistence
  let indexeddb: IndexeddbPersistence | null = null;
  if (opts.persistence === "indexeddb" && typeof window !== "undefined") {
    indexeddb = new IndexeddbPersistence(opts.id, ydoc);
  }

  // Y.Map change detection -> listener callback
  const notify = (event: Y.YMapEvent<BlockInstance>) => {
    event.changes.keys.forEach((change, key) => {
      if (change.action === "add" || change.action === "update") {
        const block = blocks.get(key);
        if (block) {
          for (const l of listeners) l({ ...block });
        }
      } else if (change.action === "delete") {
        // Notify deleted block (id only)
        for (const l of listeners) l({ id: key } as BlockInstance);
      }
    });
  };
  blocks.observe(notify);

  // Cleanup function
  const destroy = (): void => {
    blocks.unobserve(notify);
    if (wsProvider) {
      wsProvider.destroy();
      wsProvider = null;
    }
    if (indexeddb) {
      indexeddb.destroy();
      indexeddb = null;
    }
    if (awareness) {
      awareness.destroy();
    }
    ydoc.destroy();
  };

  return {
    id: opts.id,
    doc: ydoc,
    blocks,
    schemas,
    awareness,
    toJSON(): SerializedWorkspace {
      return {
        id: opts.id,
        blocks: Array.from(blocks.values()).map(blockToSerializable),
      };
    },
    fromJSON(snapshot: SerializedWorkspace): void {
      ydoc.transact(() => {
        blocks.clear();
        for (const b of snapshot.blocks) {
          blocks.set(b.id, serializableToBlock(b));
        }
      });
    },
    addBlock(block: BlockInstance): string {
      blocks.set(block.id, block);
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
      return Array.from(blocks.values()).map(b => ({ ...b, props: { ...b.props } }));
    },
    onBlockChange(cb: (b: BlockInstance) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy,
  };
}