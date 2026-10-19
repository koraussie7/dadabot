// constants.ts — Reward amounts, AI usage costs, and daily limits.
//
// All values are deliberately conservative for v1; they can be tuned per
// campaign without code changes (load from DB in production).
//
// Cost model rationale:
//   - AI providers cost varies 50–500×. We pick a single POINT cost per
//     usage-kind so users have one mental model ("1 chat ≈ 10 points").
//   - Daily limits exist to prevent a signup-farming attacker from
//     burning the company's free-tier quota.

export const POINT_COST = {
  "ai-chat": 10,             // ~1 short conversation turn
  "ai-translate": 5,         // ~1 short translation
  "ai-code": 25,             // ~1 code generation request
  "mcp-tool-call": 3,        // ~1 external tool invocation
} as const;

export const REWARD_AMOUNT = {
  "signup-bonus": 100,       // welcome credit
  "first-ai-call": 50,       // bonus for completing 1st real call (not signup alone)
  "daily-streak": 20,        // daily check-in
  "weekly-challenge": 200,   // weekly bonus
  "referral-inviter": 300,   // inviter reward when referee ACTIVATES
  "referral-invitee": 100,   // invitee bonus on signup
  "referral-activated": 50,  // additional bonus when inviter's referee hits usage threshold
  "model-contribution": 500, // base reward for publishing a working model adapter
  "tool-contribution": 200,  // base reward for publishing a tool/MCP server
  "bug-bounty": 100,         // per verified bug report
} as const;

export const DAILY_LIMITS = {
  /** Hard cap per user per day (across all usage kinds). */
  "user-daily-points": 500,
  /** Per-kind daily caps. */
  "ai-chat": 50,
  "ai-translate": 100,
  "ai-code": 20,
  "mcp-tool-call": 200,
} as const;

export type UsageKind = keyof typeof POINT_COST;

export interface QuotaStatus {
  allowed: boolean;
  remaining: { kind: UsageKind | "user-daily-points"; n: number };
  dailySpent: { kind: UsageKind | "user-daily-points"; n: number };
}
