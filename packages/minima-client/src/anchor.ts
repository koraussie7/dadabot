/**
 * anchor.ts — Content Hash Anchoring to Minima Chain
 * 
 * Anchors content hashes (SHA-256) to Minima chain via MDS.
 * Reuses Phantom RNPE-2 pattern: MDS.create({ script, amount: 0.001, state: [address, cid, ns, time, size, path] })
 * 
 * Flow:
 * 1. Hash content → SHA-256 (anchorHash)
 * 2. Store in MDS with namespace "anchor" 
 * 3. Return { txid, hash, blockHeight, timestamp }
 */
import { MinimaConfig, AnchorDataResult } from "./index.js";
import { MdsAgentMemory, type MDSStoreParams, type MDSStoreResult } from "./mds.js";
import { createHash } from "node:crypto";

export interface AnchorConfig {
  nodeUrl: string;
  apiKey?: string;
  defaultNamespace?: string;
}

export interface AnchorOptions {
  /** Content to hash and anchor (string or Uint8Array) */
  content: string | Uint8Array;
  /** Namespace for grouping anchors (default: "anchor") */
  namespace?: string;
  /** Path identifier within namespace (default: auto-generated) */
  path?: string;
  /** Address to sign with (default: from config) */
  address?: string;
  /** Additional metadata to store */
  metadata?: Record<string, any>;
}

export interface AnchorResult extends AnchorDataResult {
  cid: string;
  size: number;
  namespace: string;
  path: string;
  metadata?: Record<string, any>;
}

/** Default namespace for content anchors */
const DEFAULT_ANCHOR_NAMESPACE = "anchor";

/**
 * Anchor Client — High-level content anchoring to Minima chain
 * 
 * Uses MDS (Minima Data Service) to store content hashes on-chain.
 * Each anchor creates a Minima transaction with the content hash in state.
 */
export class AnchorClient {
  private mds: MdsAgentMemory;
  private defaultNamespace: string;
  private defaultAddress: string;

  constructor(config: AnchorConfig) {
    this.mds = new MdsAgentMemory({
      nodeUrl: config.nodeUrl,
      apiKey: config.apiKey,
    });
    this.defaultNamespace = config.defaultNamespace ?? DEFAULT_ANCHOR_NAMESPACE;
  }

  /**
   * Compute SHA-256 hash of content
   */
  static hashContent(content: string | Uint8Array): string {
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const hash = createHash("sha256").update(data).digest();
    return Array.from(hash).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Anchor content to Minima chain
   * 
   * 1. Hash content → SHA-256 (cid)
   * 2. Store in MDS with namespace
   * 3. Return { txid, hash, blockHeight, timestamp, cid }
   * 
   * @param options - Content and anchoring options
   * @returns Anchor result with txid, hash, blockHeight
   */
  async anchor(options: AnchorOptions): Promise<AnchorResult> {
    const { content, namespace, path, address, metadata } = options;
    const ns = namespace ?? this.defaultNamespace;
    const cid = AnchorClient.hashContent(content);
    const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.length;
    const timestamp = Date.now();
    const pth = path ?? `anchor/${cid.slice(0, 16)}`;
    const addr = options.address ?? ""; // Will be filled by MDS from config

    const params: MDSStoreParams = {
      cid,
      namespace: ns,
      path: pth,
      size,
      timestamp,
      address: addr,
    };

    const result = await this.mds.store({
      cid,
      namespace: ns,
      path: pth,
      size,
      timestamp,
      address: addr,
    });

    if (!result.success || !result.data) {
      throw new Error(`Anchor failed: ${result.error ?? "Unknown error"}`);
    }

    const data = result.data as { txid: string; blockHeight: number; cid: string };

    return {
      txid: data.txid,
      hash: data.cid,
      blockHeight: data.blockHeight,
      timestamp: Date.now(),
      cid: data.cid,
      size,
      namespace: ns,
      path: pth,
      metadata,
    };
  }

  /**
   * Anchor string content
   */
  async anchorString(text: string, namespace?: string, path?: string): Promise<AnchorResult> {
    return this.anchor({ content: text, namespace, path });
  }

  /**
   * Anchor binary data
   */
  async anchorBytes(bytes: Uint8Array, namespace?: string, path?: string): Promise<AnchorResult> {
    return this.anchor({ content: bytes, namespace, path });
  }

  /**
   * Retrieve anchored content by CID
   */
  async retrieve(cid: string, namespace?: string): Promise<any> {
    const ns = namespace ?? this.defaultNamespace;
    return this.mds.retrieve({ cid, namespace: ns });
  }

  /**
   * List anchored items in namespace
   */
  async list(namespace?: string, limit = 50, offset = 0): Promise<any> {
    const ns = namespace ?? this.defaultNamespace;
    return this.mds.list({ namespace: ns, limit, offset });
  }
}

export function createAnchorClient(config: AnchorConfig): AnchorClient {
  return new AnchorClient(config);
}

export function createAnchorClientFromEnv(): AnchorClient {
  const config: AnchorConfig = {
    nodeUrl: process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
    apiKey: process.env.MINIMA_API_KEY,
    defaultNamespace: process.env.MINIMA_ANCHOR_NAMESPACE ?? "anchor",
  };
  return new AnchorClient(config);
}

/**
 * Convenience function to anchor content in one call
 */
export async function anchorContent(
  content: string | Uint8Array,
  options: { namespace?: string; path?: string; nodeUrl?: string; apiKey?: string } = {}
): Promise<AnchorResult> {
  const config: AnchorConfig = {
    nodeUrl: options.nodeUrl ?? process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
    apiKey: options.apiKey ?? process.env.MINIMA_API_KEY,
    defaultNamespace: options.namespace,
  };
  const client = new AnchorClient(config);
  return client.anchor({ content, namespace: options.namespace, path: options.path });
}