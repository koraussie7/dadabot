// index.ts — Public API of @agentmesh/points.

export {
  createLedger,
  ledger,
  InsufficientPointsError,
  DuplicateIdempotencyKeyError,
  type Ledger,
  type Entry,
  type EntryKind,
  type Reason,
  type Balance,
  type IssueOptions,
  type SpendOptions,
  type TransferOptions,
} from "./ledger.ts";

export {
  createRewardEngine,
  type RewardEngine,
  type Campaign,
  type RewardRule,
  type RewardContext,
  type RewardResult,
} from "./rewards.ts";

export {
  createBudgetController,
  type BudgetController,
  type BudgetWindow,
  type BudgetResult,
} from "./budget.ts";

export {
  createReferralGraph,
  type ReferralGraph,
  type ReferralEdge,
  type ReferralStats,
} from "./referrals.ts";

export {
  createContributionRegistry,
  type ContributionRegistry,
  type Contribution,
  type ContributionKind,
} from "./contributions.ts";

export {
  createRetentionTracker,
  type RetentionTracker,
  type RetentionStats,
} from "./retention.ts";

export {
  POINT_COST,
  REWARD_AMOUNT,
  DAILY_LIMITS,
  type UsageKind,
  type QuotaStatus,
} from "./constants.ts";
