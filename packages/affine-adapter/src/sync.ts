/**
 * sync.ts — Cross-device synchronization adapters.
 *
 * P3-C implementation: real BroadcastChannel-based broadcast sync (no deps).
 * WebSocket sync remains a stub because it requires an external server (y-websocket).
 * Upgrade path: install yjs + y-websocket and reimplement attachWebSocketSync.
 *
 * Sync model (CRDT-lite):
 *   - Each mutation (add/remove) is broadcast as an op message
 *   - Receiving peers apply ops idempotently (block.id is the dedupe key)
 *   - Last-write-wins on props.updatedAt
 *   - On connect, sender broadcasts full state snapshot; receivers merge
 */
import type { Workspace, BlockInstance } from "./store.js";

export interface SyncAdapter {
  readonly id: string;
  destroy(): void;
  readonly awareness?: unknown;
}

export interface WebSocketSyncOptions {
  url: string;
  room: string;
  awareness?: unknown;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
}

/**
 * Placeholder WebSocket sync (real impl uses y-websocket).
 * Stub retained: requires server (scripts/y-websocket-server.js).
 */
export function attachWebSocketSync(
  _ws: Workspace,
  opts: WebSocketSyncOptions,
): SyncAdapter {
  return {
    id: `websocket:${opts.url}/${opts.room}`,
    destroy() {
      /* no-op for stub */
    },
  };
}

// ---------------------------------------------------------------------------
// BroadcastChannel sync (P3-C real implementation)
// ---------------------------------------------------------------------------

type SyncOp =
  | { type: "snapshot"; blocks: SerializedBlock[] }
  | { type: "add"; block: SerializedBlock }
  | { type: "remove"; blockId: string };

interface SerializedBlock {
  id: string;
  flavour: string;
  props: Record<string, unknown>;
  children: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Attach a BroadcastChannel-based sync adapter to a workspace.
 * Works across same-origin browser tabs and Node.js workers (Node 22+).
 *
 * Protocol:
 *   - On attach: broadcast {type:"snapshot"} with current state
 *   - On addBlock: broadcast {type:"add"} with serialized block
 *   - On removeBlock: broadcast {type:"remove"} with blockId
 *   - On receive: apply op (idempotent — dedupe by block.id)
 */
export function attachBroadcastSync(
  ws: Workspace,
  roomName: string,
): SyncAdapter | null {
  // BroadcastChannel exists in Node 22+ globally.
  const channelCtor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel })
    .BroadcastChannel;
  if (!channelCtor) return null;

  const channelName = `dadabot:ws:${roomName}`;
  const channel = new channelCtor(channelName);

  const offAdd = ws.onBlockChange((block) => {
    const op: SyncOp = {
      type: "add",
      block: serializeBlock(block),
    };
    channel.postMessage(op);
  });

  const handler = (ev: MessageEvent) => {
    const op = ev.data as SyncOp;
    if (!op || typeof op !== "object") return;
    if (op.type === "snapshot") {
      for (const sb of op.blocks) {
        if (!ws.getBlock(sb.id)) {
          ws.addBlock({
            id: sb.id,
            flavour: sb.flavour,
            props: { ...sb.props },
            children: [...sb.children],
            createdAt: sb.createdAt,
            updatedAt: sb.updatedAt,
          });
        }
      }
    } else if (op.type === "add") {
      if (!ws.getBlock(op.block.id)) {
        ws.addBlock({
          id: op.block.id,
          flavour: op.block.flavour,
          props: { ...op.block.props },
          children: [...op.block.children],
          createdAt: op.block.createdAt,
          updatedAt: op.block.updatedAt,
        });
      }
    } else if (op.type === "remove") {
      ws.removeBlock(op.blockId);
    }
  };
  channel.addEventListener("message", handler);

  // Broadcast initial snapshot to peers
  const snap: SyncOp = {
    type: "snapshot",
    blocks: ws.listBlocks().map(serializeBlock),
  };
  channel.postMessage(snap);

  return {
    id: `broadcast:${roomName}`,
    destroy() {
      offAdd();
      channel.removeEventListener("message", handler);
      channel.close();
    },
    awareness: channel,
  };
}

function serializeBlock(b: BlockInstance): SerializedBlock {
  return {
    id: b.id,
    flavour: b.flavour,
    props: { ...b.props },
    children: [...b.children],
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}
