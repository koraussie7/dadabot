// contributions.ts — Contributor economy for tool/model providers.
//
// Phase 3 of the strategy: "Devs and providers supply useful tools/models/compute;
// users pay them points; verified contributions earn rewards."
//
// A contribution is any artifact registered with reputation > 0:
//   - model adapter (free model X supported)
//   - tool/MCP server (capability Y available)
//   - bug report (Z fixed)
//   - doc/tutorial
//
// Reward is computed as:
//   base_amount × reputation_multiplier × usage_multiplier
// where multipliers come from the agent's prior reputation score.

import { randomUUID } from "node:crypto";

export type ContributionKind =
  | "model-adapter"
  | "tool-mcp-server"
  | "bug-report"
  | "doc-tutorial"
  | "community-answer";

export interface Contribution {
  id: string;
  kind: ContributionKind;
  contributorId: string;
  title: string;
  /** URL or pointer to the artifact (github PR, npm name, doc URL). */
  artifact: string;
  /** Optional hash/commit for tamper-evidence. */
  artifactHash?: string;
  /** Number of independent users who used this in the last 30d. */
  usageCount: number;
  /** Reviewer/admin verdict (after verification). */
  status: "pending" | "verified" | "rejected";
  reviewerNotes?: string;
  /** Reputation score of the contributor at time of verification. */
  contributorReputation: number;
  /** Final reward amount paid (in points). */
  rewardIssued: number;
  createdAt: number;
  verifiedAt?: number;
}

export interface ContributionRegistry {
  submit(input: Omit<Contribution, "id" | "status" | "rewardIssued" | "createdAt" | "usageCount">): Contribution;
  verify(id: string, accept: boolean, notes?: string, contributorReputation?: number): Contribution;
  /** Bump usage count (called when an AI call uses this contribution). */
  recordUsage(id: string): Contribution | undefined;
  list(filter?: { contributorId?: string; kind?: ContributionKind; status?: Contribution["status"] }): Contribution[];
  /** Reputation-weighted reward for a verified contribution. */
  computeReward(c: Contribution): number;
  reset(): void;
}

const BASE_REWARD: Record<ContributionKind, number> = {
  "model-adapter": 500,
  "tool-mcp-server": 200,
  "bug-report": 100,
  "doc-tutorial": 50,
  "community-answer": 30,
};

export function createContributionRegistry(): ContributionRegistry {
  const byId = new Map<string, Contribution>();

  return {
    submit(input) {
      const c: Contribution = {
        ...input,
        id: randomUUID(),
        status: "pending",
        usageCount: 0,
        rewardIssued: 0,
        createdAt: Date.now(),
      };
      byId.set(c.id, c);
      return c;
    },

    verify(id, accept, notes, contributorReputation = 0) {
      const c = byId.get(id);
      if (!c) throw new Error(`contribution_not_found: ${id}`);
      c.status = accept ? "verified" : "rejected";
      c.reviewerNotes = notes;
      c.contributorReputation = contributorReputation;
      c.verifiedAt = Date.now();
      c.rewardIssued = accept ? this.computeReward(c) : 0;
      return c;
    },

    recordUsage(id) {
      const c = byId.get(id);
      if (!c) return undefined;
      c.usageCount++;
      // verified contributions get an extra bonus at usage milestones
      if (c.status === "verified" && c.usageCount % 100 === 0) {
        c.rewardIssued += 10; // 10 points per 100 uses
      }
      return c;
    },

    list(filter) {
      let out = Array.from(byId.values());
      if (filter?.contributorId) out = out.filter((c) => c.contributorId === filter.contributorId);
      if (filter?.kind) out = out.filter((c) => c.kind === filter.kind);
      if (filter?.status) out = out.filter((c) => c.status === filter.status);
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },

    computeReward(c) {
      const base = BASE_REWARD[c.kind] ?? 50;
      // Reputation multiplier: 1.0 at 0 rep, +0.1 per 100 rep, capped at 2.0
      const repMul = Math.min(2.0, 1.0 + c.contributorReputation / 1000);
      return Math.round(base * repMul);
    },

    reset() {
      byId.clear();
    },
  };
}
