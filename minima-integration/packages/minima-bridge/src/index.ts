/**
 * @agentmesh/minima-bridge
 * 
 * Bridges Minima chain settlement with MuhanAI credit system.
 * 
 * Flow:
 * 1. settleCreditsToChain — burn credits, anchor on-chain (minima:txid)
 * 2. syncChainToCredits — listen for on-chain events, credit ledger (idempotencyKey=minima:{txid})
 * 
 * Idempotency: idempotencyKey="minima:{txid}" ensures exactly-once ledger updates.
 */
import { MinimaClient, type MinimaConfig, type MinimaTransaction } from "@agentmesh/minima-client";
import { grantCredits, spendCredits, type CreditSystem } from "@agentmesh/credit-system";

export interface MinimaBridgeConfig extends MinimaConfig {
  creditSystem: CreditSystem;
  /** Token ID for credit settlement (e.g., MINIMA, DADA) */
  settlementTokenId?: string;
  /** Confirmation depth before crediting */
  confirmationDepth?: number;
}

export interface SettlementResult {
  txid: string;
  creditsBurned: number;
  tokenId: string;
  blockHeight: number;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

export class MinimaBridge {
  private client: MinimaClient;
  private creditSystem: CreditSystem;
  private settlementTokenId: string;
  private confirmationDepth: number;
  private processedTxids = new Set<string>();

  constructor(config: MinimaBridgeConfig) {
    this.client = new MinimaClient(config);
    this.creditSystem = config.creditSystem;
    this.settlementTokenId = config.settlementTokenId ?? process.env.MINIMA_SETTLEMENT_TOKEN_ID ?? "MINIMA";
    this.confirmationDepth = config.confirmationDepth ?? 1;
  }

  /**
   * Burn credits from user wallet, anchor on-chain, return txid.
   * Creates ChangeRequest via creditSystem (if needed) then settles.
   */
  async settleCreditsToChain(
    userId: string,
    amount: number,
    tokenId: string = this.settlementTokenId,
    memo?: string
  ): Promise<SettlementResult> {
    // 1. Spend credits from credit system (burn)
    const spendResult = await spendCredits(this.creditSystem, {
      userId,
      amount,
      token: tokenId,
      idempotencyKey: `minima-burn:${userId}:${amount}:${Date.now()}`,
      metadata: { type: "chain-settlement", memo },
    });

    if (!spendResult.success) {
      throw new Error(`Credit spend failed: ${spendResult.error}`);
    }

    // 2. Send on-chain via Minima
    // In production, this would call Minima RPC send with the user's address
    // For now, we simulate with the MinimaClient
    const client = new (await import("@agentmesh/minima-client")).MinimaClient({
      nodeUrl: process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
      apiKey: process.env.MINIMA_API_KEY,
    });

    const result = await client.dada.send({
      from: process.env.MINIMA_BRIDGE_ADDRESS ?? "",
      to: process.env.MINIMA_BRIDGE_ADDRESS ?? "",
      amount: amount.toString(),
      token: tokenId,
    });

    return {
      txid: result.txid,
      creditsBurned: amount,
      tokenId,
      blockHeight: 0, // Will be updated after confirmation
    };
  }

  /**
   * Sync on-chain events to credit ledger.
   * Idempotent: uses idempotencyKey="minima:{txid}"
   */
  async syncChainToCredits(fromBlockHeight = 0): Promise<SyncResult> {
    const client = new (await import("@agentmesh/minima-client")).MinimaClient({
      nodeUrl: process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
      apiKey: process.env.MINIMA_API_KEY,
    });

    const currentHeight = await client.rpc.getBlockHeight();
    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let h = fromBlockHeight; h <= currentHeight; h++) {
      try {
        const block = await client.rpc.getBlock(h);
        for (const tx of block.transactions) {
          if (tx.token !== this.settlementTokenId) continue;
          if (this.processedTxids.has(tx.txid)) {
            skipped++;
            continue;
          }

          // Grant credits for received transactions
          // In production, map tx.to -> userId via address registry
          const userId = await this.resolveUserId(tx.to);
          if (!userId) continue;

          const idempotencyKey = `minima:${tx.txid}`;
          const grantResult = await grantCredits(this.creditSystem, {
            userId,
            amount: parseFloat(tx.amount),
            token: tx.token,
            idempotencyKey,
            metadata: { source: "minima-chain", txid: tx.txid, blockHeight: block.height },
          });

          if (grantResult.success) {
            this.processedTxids.add(tx.txid);
            synced++;
          } else {
            errors.push(`Grant failed for ${tx.txid}: ${grantResult.error}`);
          }
        }
      } catch (err) {
        errors.push(`Block ${h}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { synced, skipped, errors };
  }

  /**
   * Map Minima address to MuhanAI userId.
   * In production, this would query a registry (DB/Redis).
   */
  private async resolveUserId(address: string): Promise<string | null> {
    // Placeholder: In production, query address -> userId mapping
    return process.env.MINIMA_BRIDGE_ADDRESS === address ? "bridge-user" : null;
  }

  /** Get processed txids for idempotency checks */
  getProcessedTxids(): string[] {
    return Array.from(this.processedTxids);
  }
}

export function createMinimaBridge(config: MinimaBridgeConfig): MinimaBridge {
  return new MinimaBridge(config);
}

export function createMinimaBridgeFromEnv(creditSystem: CreditSystem): MinimaBridge {
  const config: MinimaBridgeConfig = {
    nodeUrl: process.env.MINIMA_NODE_URL ?? "http://localhost:9001",
    apiKey: process.env.MINIMA_API_KEY,
    creditSystem,
    settlementTokenId: process.env.MINIMA_SETTLEMENT_TOKEN_ID,
    confirmationDepth: parseInt(process.env.MINIMA_CONFIRMATION_DEPTH ?? "1"),
  };
  return new MinimaBridge(config);
}