/// <reference types="node" />
/**
 * @agentmesh/minima-bridge

 *
 * Bridges Minima chain settlement with MuhanAI credit ledger.
 *
 * Flow:
 * 1. settleCreditsToChain — burn credits, anchor on-chain (minima:txid)
 * 2. syncChainToCredits — listen for on-chain events, credit ledger (idempotencyKey=minima:{txid})
 *
 * Idempotency: idempotencyKey="minima:{txid}" ensures exactly-once ledger updates.
 */
import { MinimaClient, type MinimaConfig } from "../../minima-client/src/index.ts";

// Minimal local ledger interface — avoids hard dependency on @agentmesh/credit-system.
// In production, swap with the real credit-system package.
export interface CreditLedgerEntry {
  idempotencyKey: string;
  userId: string;
  amount: number;
  token: string;
  metadata?: Record<string, unknown>;
  at: number;
}

export interface CreditLedger {
  grant(entry: Omit<CreditLedgerEntry, "at">): Promise<{ success: boolean; error?: string }>;
  spend(entry: Omit<CreditLedgerEntry, "at">): Promise<{ success: boolean; error?: string }>;
  getByIdempotencyKey(key: string): Promise<CreditLedgerEntry | undefined>;
}

export interface MinimaBridgeConfig extends MinimaConfig {
  creditLedger: CreditLedger;
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
  private creditLedger: CreditLedger;
  private settlementTokenId: string;
  private confirmationDepth: number;
  private processedTxids = new Set<string>();

  constructor(config: MinimaBridgeConfig) {
    this.client = new MinimaClient(config);
    this.creditLedger = config.creditLedger;
    this.settlementTokenId =
      config.settlementTokenId ?? ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_SETTLEMENT_TOKEN_ID) ?? "MINIMA";
    this.confirmationDepth = config.confirmationDepth ?? 1;
  }

  /** Override the underlying MinimaClient (for tests) */
  setClient(client: MinimaClient): void {
    this.client = client;
  }

  /**
   * Burn credits from user wallet, anchor on-chain, return txid.
   */
  async settleCreditsToChain(
    userId: string,
    amount: number,
    tokenId: string = this.settlementTokenId,
    memo?: string
  ): Promise<SettlementResult> {
    // 1. Spend credits from ledger (burn)
    const spendResult = await this.creditLedger.spend({
      userId,
      amount,
      token: tokenId,
      idempotencyKey: `minima-burn:${userId}:${amount}:${tokenId}`,
      metadata: { type: "chain-settlement", memo },
    });

    if (!spendResult.success) {
      throw new Error(`Credit spend failed: ${spendResult.error ?? "unknown"}`);
    }

    // 2. Send on-chain via Minima
    const bridgeAddress = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_BRIDGE_ADDRESS) ?? "";
    const result = await this.client.dada.send({
      from: bridgeAddress,
      to: bridgeAddress,
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
    const currentHeight = await this.client.rpc.getBlockHeight();
    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let h = fromBlockHeight; h <= currentHeight; h++) {
      try {
        const block = await this.client.rpc.getBlock(h);
        for (const tx of block.transactions) {
          if (tx.token !== this.settlementTokenId) continue;
          if (this.processedTxids.has(tx.txid)) {
            skipped++;
            continue;
          }

          const userId = await this.resolveUserId(tx.to);
          if (!userId) continue;

          const idempotencyKey = `minima:${tx.txid}`;
          const existing = await this.creditLedger.getByIdempotencyKey(idempotencyKey);
          if (existing) {
            this.processedTxids.add(tx.txid);
            skipped++;
            continue;
          }

          const grantResult = await this.creditLedger.grant({
            userId,
            amount: parseFloat(tx.amount),
            token: tx.token,
            idempotencyKey,
            metadata: {
              source: "minima-chain",
              txid: tx.txid,
              blockHeight: block.height,
            },
          });

          if (grantResult.success) {
            this.processedTxids.add(tx.txid);
            synced++;
          } else {
            errors.push(`Grant failed for ${tx.txid}: ${grantResult.error ?? "unknown"}`);
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
    return ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_BRIDGE_ADDRESS) === address ? "bridge-user" : null;
  }

  /** Get processed txids for idempotency checks */
  getProcessedTxids(): string[] {
    return Array.from(this.processedTxids);
  }
}

export function createMinimaBridge(config: MinimaBridgeConfig): MinimaBridge {
  return new MinimaBridge(config);
}

export function createMinimaBridgeFromEnv(creditLedger: CreditLedger): MinimaBridge {
  const config: MinimaBridgeConfig = {
    nodeUrl: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_NODE_URL) ?? "http://localhost:9001",
    apiKey: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_API_KEY),
    creditLedger,
    settlementTokenId: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_SETTLEMENT_TOKEN_ID),
    confirmationDepth: parseInt(((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.MINIMA_CONFIRMATION_DEPTH) ?? "1", 10),
  };
  return new MinimaBridge(config);
}
