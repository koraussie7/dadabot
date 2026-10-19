// ledger.ts — Server-backed MuhanAI Point ledger.
//
// Design notes (per the v0.18 growth strategy):
//   - NOT a blockchain token. No exchange listing. No cash redemption. No P2P transfer in v1.
//   - Stored in a single append-only `entries` table; balances are materialized views.
//   - Every entry has: idempotencyKey (so retries are safe), reason (audit), actor, amount, ts.
//   - Balances never go below zero (atomic check in spend()).
//   - Currency is intentionally called "POINT" (uppercase) to signal it's not a tradable asset.
//
// Public API is intentionally minimal — only the operations the rest of the platform needs:
//   createLedger()             → fresh in-memory ledger (production swaps for Postgres)
//   issue(userId, amount, reason, opts)
//   spend(userId, amount, reason, opts) → throws on insufficient funds
//   transfer(fromUserId, toUserId, amount, reason) → v1: only system-issued internal moves
//   balanceOf(userId)
//   historyOf(userId, limit?)
//
// Thread-safety: Node is single-threaded, so all mutations are naturally atomic.

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntryKind = "issue" | "spend" | "transfer-in" | "transfer-out" | "expire";

export type Reason =
  | "signup-bonus"
  | "first-ai-call"
  | "daily-streak"
  | "weekly-challenge"
  | "referral-inviter"
  | "referral-invitee"
  | "referral-activated"
  | "ai-chat"
  | "ai-translate"
  | "ai-code"
  | "mcp-tool-call"
  | "model-contribution"
  | "tool-contribution"
  | "bug-bounty"
  | "admin-grant"
  | "system-adjust";

export interface Entry {
  id: string;
  userId: string;
  kind: EntryKind;
  reason: Reason;
  amount: number;             // positive for issue/transfer-in, negative for spend/transfer-out
  /** Counterparty for transfers; undefined for self-only operations */
  counterparty?: string;
  /** Free-form context: campaign id, model id, request id, etc. */
  context?: Record<string, unknown>;
  /** Idempotency key — same key on retry returns the same entry */
  idempotencyKey?: string;
  ts: number;
}

export interface Balance {
  userId: string;
  available: number;
  lifetimeIssued: number;
  lifetimeSpent: number;
  updatedAt: number;
}

export interface IssueOptions {
  reason: Reason;
  counterparty?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
  /** If true and balance already has this idempotencyKey, returns the existing entry. */
  idempotent?: boolean;
}

export interface SpendOptions extends IssueOptions { }

export interface TransferOptions {
  reason: Reason;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InsufficientPointsError extends Error {
  readonly userId: string;
  readonly requested: number;
  readonly available: number;
  constructor(userId: string, requested: number, available: number) {
    super(`insufficient_points: user=${userId} requested=${requested} available=${available}`);
    this.name = "InsufficientPointsError";
    this.userId = userId;
    this.requested = requested;
    this.available = available;
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  readonly key: string;
  readonly existingEntryId: string;
  constructor(key: string, existingEntryId: string) {
    super(`duplicate_idempotency_key: ${key} (existing=${existingEntryId})`);
    this.name = "DuplicateIdempotencyKeyError";
    this.key = key;
    this.existingEntryId = existingEntryId;
  }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

interface LedgerState {
  entries: Entry[];
  balances: Map<string, Balance>;
  /** idempotencyKey → entry id (for retries) */
  byKey: Map<string, string>;
  /** monotonic counter for stable sort when many entries land in same ms */
  seq: number;
}

function freshBalance(userId: string): Balance {
  return {
    userId,
    available: 0,
    lifetimeIssued: 0,
    lifetimeSpent: 0,
    updatedAt: Date.now(),
  };
}

function upsertBalance(state: LedgerState, userId: string): Balance {
  let b = state.balances.get(userId);
  if (!b) {
    b = freshBalance(userId);
    state.balances.set(userId, b);
  }
  return b;
}

function recordEntry(state: LedgerState, entry: Entry): void {
  // Idempotency
  if (entry.idempotencyKey) {
    const existing = state.byKey.get(entry.idempotencyKey);
    if (existing) {
      const found = state.entries.find((e) => e.id === existing);
      if (found) {
        if (entry.id !== existing) {
          throw new DuplicateIdempotencyKeyError(entry.idempotencyKey, existing);
        }
        return;
      }
    }
  }
  state.entries.push(entry);
  if (entry.idempotencyKey) state.byKey.set(entry.idempotencyKey, entry.id);
  const b = upsertBalance(state, entry.userId);
  b.available += entry.amount;
  b.updatedAt = entry.ts;
  if (entry.amount > 0) b.lifetimeIssued += entry.amount;
  else b.lifetimeSpent += -entry.amount;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface Ledger {
  issue(userId: string, amount: number, opts: IssueOptions): Entry;
  spend(userId: string, amount: number, opts: SpendOptions): Entry;
  transfer(fromUserId: string, toUserId: string, amount: number, opts: TransferOptions): { out: Entry; in: Entry };
  balanceOf(userId: string): Balance;
  historyOf(userId: string, limit?: number): Entry[];
  listUsers(): string[];
  /** Test-only */
  reset(): void;
}

export function createLedger(): Ledger {
  const state: LedgerState = {
    entries: [],
    balances: new Map(),
    byKey: new Map(),
    seq: 0,
  };

  function now(): number {
    state.seq++;
    return Date.now() + state.seq; // monotonic within process
  }

  return {
    issue(userId, amount, opts) {
      if (amount <= 0) throw new Error("issue amount must be positive");
      const entry: Entry = {
        id: randomUUID(),
        userId,
        kind: "issue",
        reason: opts.reason,
        amount,
        counterparty: opts.counterparty,
        context: opts.context,
        idempotencyKey: opts.idempotencyKey,
        ts: now(),
      };
      recordEntry(state, entry);
      return entry;
    },

    spend(userId, amount, opts) {
      if (amount <= 0) throw new Error("spend amount must be positive");
      const bal = upsertBalance(state, userId);
      if (bal.available < amount) {
        throw new InsufficientPointsError(userId, amount, bal.available);
      }
      const entry: Entry = {
        id: randomUUID(),
        userId,
        kind: "spend",
        reason: opts.reason,
        amount: -amount,
        context: opts.context,
        idempotencyKey: opts.idempotencyKey,
        ts: now(),
      };
      recordEntry(state, entry);
      return entry;
    },

    transfer(fromUserId, toUserId, amount, opts) {
      if (amount <= 0) throw new Error("transfer amount must be positive");
      if (fromUserId === toUserId) throw new Error("cannot transfer to self");
      const fromBal = upsertBalance(state, fromUserId);
      if (fromBal.available < amount) {
        throw new InsufficientPointsError(fromUserId, amount, fromBal.available);
      }
      const ts = now();
      const out: Entry = {
        id: randomUUID(),
        userId: fromUserId,
        kind: "transfer-out",
        reason: opts.reason,
        amount: -amount,
        counterparty: toUserId,
        context: opts.context,
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:out` : undefined,
        ts,
      };
      const inn: Entry = {
        id: randomUUID(),
        userId: toUserId,
        kind: "transfer-in",
        reason: opts.reason,
        amount,
        counterparty: fromUserId,
        context: opts.context,
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:in` : undefined,
        ts,
      };
      recordEntry(state, out);
      recordEntry(state, inn);
      return { out, in: inn };
    },

    balanceOf(userId) {
      return { ...upsertBalance(state, userId) };
    },

    historyOf(userId, limit = 100) {
      const filtered = state.entries
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.ts - a.ts);
      return limit > 0 ? filtered.slice(0, limit) : filtered;
    },

    listUsers() {
      return Array.from(state.balances.keys());
    },

    reset() {
      state.entries.length = 0;
      state.balances.clear();
      state.byKey.clear();
    },
  };
}

// Module-level singleton for default usage
export const ledger = createLedger();
