// ============================================================================
// @agentmesh/minima-client
// MuhanAI × dada-minima-node (Forked Minima Blockchain) Integration Client
// License: Apache-2.0 (inherited from dada-minima-node/minima/LICENSE)
// ============================================================================

export interface MinimaConfig {
  nodeUrl: string;
  wsUrl: string;
  apiKey?: string;
  network?: 'mainnet' | 'testnet' | 'private';
}

export interface MinimaIdentity {
  address: string;
  publicKey: string;
  did: string;
}

export interface MinimaTransaction {
  txid: string;
  from: string;
  to: string;
  amount: string;
  token: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  fee?: string;
}

export interface MinimaBlockInfo {
  height: number;
  hash: string;
  timestamp: number;
  txCount: number;
}

export interface DADABalance {
  address: string;
  token: string;
  amount: string;
  usdValue?: number;
}

export interface AnchorDataResult {
  txid: string;
  hash: string;
  blockHeight: number;
  timestamp: number;
}

// Re-export RPC module
export {
  MinimaRpc,
  type RpcRequest,
  type RpcResponse,
  type RpcBalance,
  type RpcSendResult,
  type RpcAddress,
  type RpcBlock,
  type GetBalanceParams,
  type SendParams,
  type GetAddressParams,
  type GetBlockParams,
  createMinimaRpc,
  createMinimaRpcFromEnv,
} from "./rpc.js";

// Re-export MDS module
export {
  MdsAgentMemory,
  type MDSConfig,
  type MDSStoreParams,
  type MDSRetrieveParams,
  type MDSListParams,
  type MDSStoredItem,
  type MDSCommandResult,
  type MDSStoreResult,
  type MDSListResult,
  createMdsAgentMemory,
  createMdsAgentMemoryFromEnv,
  mdsCmd,
} from "./mds.js";

// Re-export Anchor module
export {
  AnchorClient,
  type AnchorConfig,
  type AnchorOptions,
  type AnchorResult,
  AnchorClient as Anchor,
  createAnchorClient,
  createAnchorClientFromEnv,
  anchorContent,
} from "./anchor.js";

// Re-export DADA module
export {
  DadaClient,
  type DadaConfig,
  type DadaSendParams,
  type DadaSendResult,
  type DadaBalanceResult,
  createDadaClient,
  createDadaClientFromEnv,
  sendDada,
  isDadaConfigured,
} from "./dada.js";

/**
 * Minima Blockchain Client for MuhanAI
 * Connects to dada-minima-node (forked Minima full node)
 * 
 * High-level client combining RPC, MDS, Anchor, and DADA functionality.
 */
export class MinimaClient {
  private config: MinimaConfig;
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<(data: any) => void>> = new Map();
  private _rpc: MinimaRpc | null = null;
  private _mds: any = null;
  private _anchor: any = null;
  private _dada: any = null;

  constructor(config: MinimaConfig) {
    this.config = config;
  }

  /** Get RPC client for low-level calls */
  get rpc(): MinimaRpc {
    if (!this._rpc) {
      const { MinimaRpc } = require("./rpc.js");
      this._rpc = new MinimaRpc(this.config);
    }
    return this._rpc;
  }

  /** Get MDS client for agent memory operations */
  get mds(): any {
    if (!this._mds) {
      const { MdsAgentMemory } = require("./mds.js");
      this._mds = new MdsAgentMemory({ nodeUrl: this.config.nodeUrl, apiKey: this.config.apiKey });
    }
    return this._mds;
  }

  /** Get Anchor client for content anchoring */
  get anchor(): any {
    if (!this._anchor) {
      const { AnchorClient } = require("./anchor.js");
      this._anchor = new AnchorClient({ nodeUrl: this.config.nodeUrl, apiKey: this.config.apiKey });
    }
    return this._anchor;
  }

  /** Get DADA token client */
  get dada(): any {
    if (!this._dada) {
      const { DadaClient } = require("./dada.js");
      this._dada = new DadaClient({
        nodeUrl: this.config.nodeUrl,
        wsUrl: this.config.wsUrl,
        apiKey: this.config.apiKey,
        network: this.config.network,
      });
    }
    return this._dada;
  }

}
  return new MinimaClient(config);
}

export function createMinimaClientFromEnv(): MinimaClient {
  const config: MinimaConfig = {
    nodeUrl: process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
    wsUrl: process.env.MINIMA_WS_URL ?? "ws://localhost:9002",
    apiKey: process.env.MINIMA_API_KEY,
    network: (process.env.MINIMA_NETWORK as any) ?? "testnet",
  };
  return new MinimaClient(config);
}