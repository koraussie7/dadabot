// rewards.ts — Reward engine that issues points for defined events.
//
// A "campaign" is a named set of rules. Multiple campaigns can coexist
// (e.g., "launch-week-bonus" overrides "default-signup"). First match wins
// per event.

import { randomUUID } from "node:crypto";
import { DuplicateIdempotencyKeyError } from "./ledger.ts";
import type { Ledger, Entry, Reason } from "./ledger.ts";

export interface RewardRule {
  /** Stable id; used for idempotency. */
  id: string;
  /** What user action triggers this rule. */
  trigger: Reason;
  /** Minimum points to award (v1: single value; v2: ranges by tier). */
  amount: number;
  /** Optional cap: max number of times this rule fires per user. */
  perUserCap?: number;
  /** Optional absolute expiry: epoch ms. */
  expiresAt?: number;
  /** Optional min lifetime spend by user before rule fires (anti-gaming). */
  minUserSpend?: number;
}

export interface Campaign {
  id: string;
  name: string;
  /** Higher priority campaigns override lower ones. */
  priority: number;
  /** If false, rules don't fire (campaign paused). */
  active: boolean;
  rules: RewardRule[];
}

export interface RewardContext {
  userId: string;
  reason: Reason;
  /** Per-rule extras: model id, invitee id, streak count, etc. */
  meta?: Record<string, unknown>;
  /** Optional idempotency key — same key returns the same entry (or none). */
  idempotencyKey?: string;
}

export interface RewardResult {
  fired: boolean;
  rule?: RewardRule;
  campaign?: Campaign;
  entry?: Entry;
  reason?: "no_match" | "expired" | "per_user_cap" | "inactive" | "min_spend";
}

export interface RewardEngine {
  registerCampaign(c: Campaign): void;
  removeCampaign(id: string): void;
  listCampaigns(): Campaign[];
  /** Fire any matching rule for ctx. Returns the first match (highest priority). */
  fire(ctx: RewardContext): RewardResult;
  /** Test helper */
  reset(): void;
}

export function createRewardEngine(ledger: Ledger): RewardEngine {
  const campaigns = new Map<string, Campaign>();

  function countFired(ruleId: string, userId: string): number {
    // Walk the user's history and count entries that match this rule's idempotency key prefix.
    // Convention: rule.id becomes a prefix in the entry's idempotencyKey when fired.
    const prefix = `rule:${ruleId}:`;
    let n = 0;
    for (const e of ledger.historyOf(userId, 0)) {
      if (e.idempotencyKey && e.idempotencyKey.startsWith(prefix)) n++;
    }
    return n;
  }

  return {
    registerCampaign(c) {
      campaigns.set(c.id, c);
    },
    removeCampaign(id) {
      campaigns.delete(id);
    },
    listCampaigns() {
      return Array.from(campaigns.values()).sort((a, b) => b.priority - a.priority);
    },

    fire(ctx) {
      const ordered = Array.from(campaigns.values()).sort((a, b) => b.priority - a.priority);
      for (const c of ordered) {
        if (!c.active) continue;
        for (const rule of c.rules) {
          if (rule.trigger !== ctx.reason) continue;
          if (rule.expiresAt && Date.now() > rule.expiresAt) {
            return { fired: false, rule, campaign: c, reason: "expired" };
          }
          if (rule.perUserCap && countFired(rule.id, ctx.userId) >= rule.perUserCap) {
            return { fired: false, rule, campaign: c, reason: "per_user_cap" };
          }
          if (rule.minUserSpend) {
            const bal = ledger.balanceOf(ctx.userId);
            if (bal.lifetimeSpent < rule.minUserSpend) {
              return { fired: false, rule, campaign: c, reason: "min_spend" };
            }
          }

          const key = `rule:${rule.id}:${ctx.idempotencyKey ?? randomUUID()}`;
          let entry: Entry;
          try {
            entry = ledger.issue(ctx.userId, rule.amount, {
              reason: ctx.reason,
              context: { ...ctx.meta, campaignId: c.id, ruleId: rule.id },
              idempotencyKey: key,
            });
          } catch (e) {
            if (e instanceof DuplicateIdempotencyKeyError) {
              // Retry is hitting the same entry; look it up and return it.
              const existing = ledger.historyOf(ctx.userId, 0).find((x) => x.idempotencyKey === key);
              if (existing) {
                return { fired: true, rule, campaign: c, entry: existing };
              }
            }
            throw e;
          }
          return { fired: true, rule, campaign: c, entry };
        }
      }
      return { fired: false, reason: "no_match" };
    },

    reset() {
      campaigns.clear();
    },
  };
}
