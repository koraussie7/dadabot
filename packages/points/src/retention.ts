// retention.ts — Growth-quality metrics.
//
// Strategy doc: "Don't track signups only. Track 7d/30d retention and real-AI-usage rate."
//
// Each user has a "touch" timestamp per day they actually called AI.
// 7d retention = unique users active in last 7 days / unique users who signed up in prior window.
// 30d retention = same but 30 days.
// AI usage rate = users with >= 1 AI call in last 7 days / total users.

export interface RetentionTracker {
  /** Record a signup. */
  signup(userId: string, ts?: number): void;
  /** Record that user performed an AI call (or any usage-kind). */
  activity(userId: string, ts?: number): void;
  /** Compute current retention stats. */
  stats(now?: number): RetentionStats;
  /** Snapshot for tests/debug. */
  dump(): { signups: number; activities: number };
  reset(): void;
}

export interface RetentionStats {
  totalUsers: number;
  usersActive7d: number;
  usersActive30d: number;
  /** % of all-time users active in last 7 days. */
  retentionRate7d: number;
  /** % of all-time users active in last 30 days. */
  retentionRate30d: number;
  /** % of users with at least one AI call. */
  aiUsageRate: number;
}

function dayBucket(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

export function createRetentionTracker(): RetentionTracker {
  const firstSeen = new Map<string, number>();
  const lastActive = new Map<string, number>();
  let totalSignups = 0;
  let totalActivities = 0;

  return {
    signup(userId, ts = Date.now()) {
      if (!firstSeen.has(userId)) {
        firstSeen.set(userId, ts);
        totalSignups++;
      }
    },

    activity(userId, ts = Date.now()) {
      lastActive.set(userId, Math.max(lastActive.get(userId) ?? 0, ts));
      totalActivities++;
    },

    stats(now = Date.now()) {
      const today = dayBucket(now);
      let active7 = 0;
      let active30 = 0;
      let activeEver = 0;
      for (const ts of lastActive.values()) {
        if (ts > 0) activeEver++;
        const ageDays = today - dayBucket(ts);
        if (ageDays < 7) active7++;
        if (ageDays < 30) active30++;
      }
      const total = firstSeen.size;
      return {
        totalUsers: total,
        usersActive7d: active7,
        usersActive30d: active30,
        retentionRate7d: total === 0 ? 0 : active7 / total,
        retentionRate30d: total === 0 ? 0 : active30 / total,
        aiUsageRate: total === 0 ? 0 : activeEver / total,
      };
    },

    dump() {
      return { signups: totalSignups, activities: totalActivities };
    },

    reset() {
      firstSeen.clear();
      lastActive.clear();
      totalSignups = 0;
      totalActivities = 0;
    },
  };
}
