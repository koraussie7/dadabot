/**
 * sync.ts — Real-time synchronization providers.
 * 
 * Replaces stubs with real WebSocket + BroadcastChannel implementations.
 * Uses y-websocket for WebSocket and native BroadcastChannel for local tabs.
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export interface SyncOptions {
  doc: Y.Doc;
  roomName: string;
  websocketUrl?: string; // 예: "wss://sync.dadabot.dev"
  broadcastChannelName?: string; // 로컬 탭 간 동기화용
  awareness?: any; // y-websocket awareness
}

/**
 * WebSocket 기반 동기화 (멀티 디바이스/서버)
 * y-websocket 프로바이더 사용
 */
export function attachWebSocketSync(opts: SyncOptions): {
  destroy: () => void;
  provider: any;
} {
  if (!opts.websocketUrl) {
    console.warn("[sync] websocketUrl not provided, skipping WebSocket sync");
    return { destroy: () => {}, provider: null };
  }

  const provider = new WebsocketProvider(
    opts.websocketUrl,
    opts.roomName,
    opts.doc,
    {
      connect: true,
      maxBackoffTime: 10000,
      awareness: opts.awareness,
    }
  );

  provider.on("status", (event: { status: string }) => {
    console.log(`[y-websocket] ${event.status}`);
  });

  provider.on("sync", (isSynced: boolean) => {
    console.log(`[y-websocket] ${isSynced ? "synced" : "unsynced"}`);
  });

  return {
    provider,
    destroy: () => {
      provider.destroy();
    },
  };
}

/**
 * BroadcastChannel 기반 동기화 (동일 브라우저 내 탭 간)
 * 별도 서버 불필요, 로컬 탭 간 CRDT 동기화
 */
export function attachBroadcastSync(opts: {
  doc: Y.Doc;
  channelName: string;
}): {
  destroy: () => void;
  channel: BroadcastChannel;
} {
  if (typeof BroadcastChannel === "undefined") {
    console.warn("[sync] BroadcastChannel not available (Node.js?)");
    return { destroy: () => {}, channel: null as any };
  }

  const channel = new BroadcastChannel(opts.channelName);
  const doc = opts.doc;

  // 로컬 변경 → 브로드캐스트
  const localObserver = (event: Y.YMapEvent<any>) => {
    const updates = doc.encodeStateAsUpdate();
    channel.postMessage({ type: "update", data: Array.from(new Uint8Array(updates)) });
  };
  doc.on("update", localObserver);

  // 원격 변경 수신 → 적용
  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "update" && event.data.data) {
      const update = new Uint8Array(event.data.data);
      Y.applyUpdate(doc, update);
    }
  };

  return {
    channel,
    destroy: () => {
      doc.off("update", localObserver);
      channel.close();
    },
  };
}

/**
 * 통합 동기화 — WebSocket + BroadcastChannel 동시 사용
 * 서버 ↔ 클라이언트 + 탭 간 동기화 동시 지원
 */
export function attachHybridSync(opts: {
  doc: Y.Doc;
  roomName: string;
  websocketUrl?: string;
  broadcastChannelName?: string;
}): {
  destroy: () => void;
  wsProvider: any;
  bcChannel: BroadcastChannel | null;
} {
  const ws = opts.websocketUrl 
    ? attachWebSocketSync({ 
        doc: opts.doc, 
        roomName: opts.roomName, 
        websocketUrl: opts.websocketUrl 
      }) 
    : { destroy: () => {}, provider: null };

  const bc = opts.broadcastChannelName
    ? attachBroadcastSync({ 
        doc: opts.doc, 
        channelName: opts.broadcastChannelName 
      })
    : { destroy: () => {}, channel: null };

  return {
    destroy: () => {
      ws.destroy();
      bc.destroy();
    },
    wsProvider: ws.provider,
    bcChannel: bc.channel,
  };
}