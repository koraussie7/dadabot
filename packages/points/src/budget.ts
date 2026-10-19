// budget.ts — Cost-control governor for the points economy.
//
// Three concerns from the strategy doc:
//   1. Total reward budget per campaign → REWARD budget window
//   2. Per-user daily usage limits     → USAGE quota window
//   3. Cost of AI usage                → point cost per usage-kind
//
// The budget controller wraps the ledger and:
//   - records every issue/spend with a window key (e.g., "campaign:launch:2026-10")
//   - answers "is this operation allowed?" before it happens
//   - enforces hard caps (refuses the operation, does NOT silently cap)

import type { Ledger, Reason } from "./ledger.ts";
import { POINT_COST, DAILY_LIMITS, type UsageKind } from "./constants.ts";

export interface BudgetWindow {
  /** Stable id: "campaign:launch-week" or "daily:2026-10-19" etc. */
  id: string;
  /** Maximum total issue (or spend, depending on kind) allowed in this window. */
  cap: number;
  /** "issue" caps reward outflow; "spend" caps usage outflow; "net" caps net change. */
  kind: "issue" | "spend" | "net";
  /** Resets the window at this timestamp (epoch ms). */
  resetsAt?: number;
}

export interface BudgetResult {
  allowed: boolean;
  current: number;
  cap: number;
  remaining: number;
  reason?: "exceeded_cap" | "window_reset_required" | "per_user_limit" | "ok";
}

export interface BudgetController {
  /** Pre-check: can we issue/spend this amount under this window? */
  check(windowId: string, amount: number, kind: "issue" | "spend"): BudgetResult;
  /** Apply and record. Throws if check() would have failed. */
  apply(
    windowId: string,
    amount: number,
    kind: "issue" | "spend",
    effect: () => void,
  ): BudgetResult;
  /** Per-user daily quota for a usage kind. */
  checkUserDaily(userId: string, kind: UsageKind, pointsCost: number): BudgetResult;
  /** Compute point cost for a usage kind. */
  costOf(kind: UsageKind): number;
  /** Register a new budget window. */
  registerWindow(w: BudgetWindow): void;
  /** List registered windows. */
  listWindows(): BudgetWindow[];
  /** Inspect current usage of a window. */
  usageOf(windowId: string): number;
  /** Reset (test helper). */
  reset(): void;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function createBudgetController(ledger: Ledger): BudgetController {
  const windows = new Map<string, BudgetWindow>();
  const used = new Map<string, number>();

  function bumpWindow(windowId: string, amount: number): void {
    used.set(windowId, (used.get(windowId) ?? 0) + amount);
  }

  return {
    check(windowId, amount, kind) {
      const w = windows.get(windowId);
      if (!w) {
        return { allowed: true, current: 0, cap: Infinity, remaining: Infinity, reason: "ok" };
      }
      if (w.kind !== kind && w.kind !== "net") {
        return { allowed: true, current: 0, cap: Infinity, remaining: Infinity, reason: "ok" };
      }
      const current = used.get(windowId) ?? 0;
      const next = current + amount;
      if (next > w.cap) {
        return {
          allowed: false,
          current,
          cap: w.cap,
          remaining: w.cap - current,
          reason: "exceeded_cap",
        };
      }
      return { allowed: true, current: next, cap: w.cap, remaining: w.cap - next, reason: "ok" };
    },

    apply(windowId, amount, kind, effect) {
      const r = this.check(windowId, amount, kind);
      if (!r.allowed) return r;
      bumpWindow(windowId, amount);
      effect();
      return r;
    },

    checkUserDaily(userId, kind, pointsCost) {
      const wkey = `daily:${dayKey(Date.now())}:${userId}:${kind}`;
      const w = windows.get(wkey) ?? {
        id: wkey,
        cap: DAILY_LIMITS[kind] ?? DAILY_LIMITS["user-daily-points"],
        kind: "spend",
      };
      const current = used.get(wkey) ?? 0;
      const next = current + pointsCost;
      if (next > w.cap) {
        return {
          allowed: false,
          current,
          cap: w.cap,
          remaining: w.cap - current,
          reason: "per_user_limit",
        };
      }
      used.set(wkey, next);
      // also register the window for visibility
      windows.set(wkey, w);
      return { allowed: true, current: next, cap: w.cap, remaining: w.cap - next, reason: "ok" };
    },

    costOf(kind) {
      return POINT_COST[kind];
    },

    registerWindow(w) {
      windows.set(w.id, w);
    },

    listWindows() {
      return Array.from(windows.values());
    },

    usageOf(windowId) {
      return used.get(windowId) ?? 0;
    },

    reset() {
      windows.clear();
      used.clear();
    },
  };
}

// Helper: build a campaign window that auto-resets at end of week
export function weeklyCampaignWindow(id: string, cap: number): BudgetWindow {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysUntilSunday = 7 - dayOfWeek;
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + daysUntilSunday);
  end.setUTCHours(23, 59, 59, 999);
  return { id, cap, kind: "issue", resetsAt: end.getTime() };
}

export { type Reason };
