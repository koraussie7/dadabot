// points-routes.ts — REST endpoints for the points subsystem.
//
// Mounted under /api/points/* and /api/referrals/* and /api/contributions/* and /api/growth/*
// Reuses the web-app/server/router.ts pattern.
//
// Public surface:
//   GET    /api/points/balance/:userId
//   GET    /api/points/history/:userId?limit=50
//   POST   /api/points/issue       (admin) — body { userId, amount, reason, idempotencyKey? }
//   POST   /api/points/spend       — body { userId, amount, reason, idempotencyKey? }
//   POST   /api/points/transfer    — body { fromUserId, toUserId, amount, reason }
//
//   POST   /api/referrals/code     — body { inviterId } → { code }
//   POST   /api/referrals/signup   — body { inviteeId, inviteCode }
//   POST   /api/referrals/activate — body { inviteeId }
//   GET    /api/referrals/stats/:inviterId
//
//   POST   /api/contributions      — body { kind, contributorId, title, artifact }
//   POST   /api/contributions/:id/verify — body { accept, notes?, contributorReputation? }
//   POST   /api/contributions/:id/use
//   GET    /api/contributions      — query ?contributorId&kind&status
//
//   GET    /api/growth/stats       — retention + AI usage rate
//   POST   /api/growth/signup      — body { userId } (record signup)
//   POST   /api/growth/activity    — body { userId } (record AI call)

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createLedger,
  createRewardEngine,
  createBudgetController,
  createReferralGraph,
  createContributionRegistry,
  createRetentionTracker,
  InsufficientPointsError,
  DuplicateIdempotencyKeyError,
  type Ledger,
  type RewardEngine,
  type BudgetController,
  type ReferralGraph,
  type ContributionRegistry,
  type RetentionTracker,
  type Reason,
  type ContributionKind,
} from "../../../packages/points/src/index.ts";

// ---------------------------------------------------------------------------
// Singleton wiring
// ---------------------------------------------------------------------------

export interface GrowthSystem {
  ledger: Ledger;
  rewards: RewardEngine;
  budget: BudgetController;
  referrals: ReferralGraph;
  contributions: ContributionRegistry;
  retention: RetentionTracker;
}

export function createGrowthSystem(): GrowthSystem {
  const ledger = createLedger();
  const rewards = createRewardEngine(ledger);
  const budget = createBudgetController(ledger);
  const referrals = createReferralGraph();
  const contributions = createContributionRegistry();
  const retention = createRetentionTracker();

  // Bootstrap default campaigns (the "launch-week" set from the growth doc).
  rewards.registerCampaign({
    id: "default-launch",
    name: "Launch Week (default)",
    priority: 10,
    active: true,
    rules: [
      { id: "r-signup", trigger: "signup-bonus", amount: 100 },
      { id: "r-first-ai", trigger: "first-ai-call", amount: 50 },
      { id: "r-daily", trigger: "daily-streak", amount: 20, perUserCap: 7 },
      { id: "r-weekly", trigger: "weekly-challenge", amount: 200, perUserCap: 1 },
      { id: "r-ref-inviter", trigger: "referral-activated", amount: 300 },
      { id: "r-ref-invitee", trigger: "referral-invitee", amount: 100 },
    ],
  });

  // Bootstrap a campaign budget window (10M points/week during launch).
  budget.registerWindow({
    id: "campaign:launch:weekly",
    cap: 10_000_000,
    kind: "issue",
  });

  return { ledger, rewards, budget, referrals, contributions, retention };
}

export const growth = createGrowthSystem();

// ---------------------------------------------------------------------------
// HTTP helpers (mirrors web-app/server/router.ts style)
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handlePointsRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    // ---- /api/points/balance/:userId ----------------------------------
    const balanceMatch = path.match(/^\/api\/points\/balance\/([^/]+)$/);
    if (balanceMatch && method === "GET") {
      return void json(res, 200, { ok: true, balance: growth.ledger.balanceOf(balanceMatch[1]!) });
    }

    // ---- /api/points/history/:userId?limit= ---------------------------
    const historyMatch = path.match(/^\/api\/points\/history\/([^/]+)$/);
    if (historyMatch && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return void json(res, 200, {
        ok: true,
        entries: growth.ledger.historyOf(historyMatch[1]!, limit),
      });
    }

    // ---- POST /api/points/issue ---------------------------------------
    if (path === "/api/points/issue" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const userId = String(body["userId"] ?? "");
      const amount = Number(body["amount"] ?? 0);
      const reason = String(body["reason"] ?? "") as Reason;
      if (!userId || amount <= 0 || !reason) {
        return void json(res, 400, { ok: false, error: { code: "invalid_input" } });
      }
      try {
        const entry = growth.ledger.issue(userId, amount, {
          reason,
          idempotencyKey: typeof body["idempotencyKey"] === "string" ? (body["idempotencyKey"] as string) : undefined,
          context: typeof body["context"] === "object" ? (body["context"] as Record<string, unknown>) : undefined,
        });
        return void json(res, 201, { ok: true, entry });
      } catch (e) {
        if (e instanceof DuplicateIdempotencyKeyError) {
          return void json(res, 409, { ok: false, error: { code: "duplicate_idempotency_key" } });
        }
        throw e;
      }
    }

    // ---- POST /api/points/spend ---------------------------------------
    if (path === "/api/points/spend" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const userId = String(body["userId"] ?? "");
      const amount = Number(body["amount"] ?? 0);
      const reason = String(body["reason"] ?? "") as Reason;
      if (!userId || amount <= 0 || !reason) {
        return void json(res, 400, { ok: false, error: { code: "invalid_input" } });
      }
      try {
        const entry = growth.ledger.spend(userId, amount, {
          reason,
          idempotencyKey: typeof body["idempotencyKey"] === "string" ? (body["idempotencyKey"] as string) : undefined,
        });
        return void json(res, 200, { ok: true, entry });
      } catch (e) {
        if (e instanceof InsufficientPointsError) {
          return void json(res, 402, { ok: false, error: { code: "insufficient_points", message: e.message } });
        }
        if (e instanceof DuplicateIdempotencyKeyError) {
          return void json(res, 409, { ok: false, error: { code: "duplicate_idempotency_key" } });
        }
        throw e;
      }
    }

    // ---- POST /api/points/transfer ------------------------------------
    if (path === "/api/points/transfer" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const from = String(body["fromUserId"] ?? "");
      const to = String(body["toUserId"] ?? "");
      const amount = Number(body["amount"] ?? 0);
      const reason = String(body["reason"] ?? "system-adjust") as Reason;
      try {
        const r = growth.ledger.transfer(from, to, amount, { reason });
        return void json(res, 200, { ok: true, ...r });
      } catch (e) {
        if (e instanceof InsufficientPointsError) {
          return void json(res, 402, { ok: false, error: { code: "insufficient_points" } });
        }
        throw e;
      }
    }

    // ---- /api/referrals/code ------------------------------------------
    if (path === "/api/referrals/code" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const inviterId = String(body["inviterId"] ?? "");
      if (!inviterId) return void json(res, 400, { ok: false, error: { code: "invalid_input" } });
      const code = growth.referrals.ensureCode(inviterId);
      return void json(res, 200, { ok: true, code });
    }

    // ---- /api/referrals/signup ----------------------------------------
    if (path === "/api/referrals/signup" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const inviteeId = String(body["inviteeId"] ?? "");
      const inviteCode = String(body["inviteCode"] ?? "");
      const edge = growth.referrals.recordSignup(inviteeId, inviteCode);
      // fire signup-bonus reward
      growth.retention.signup(inviteeId);
      const r = growth.rewards.fire({ userId: inviteeId, reason: "signup-bonus" });
      // fire referral-invitee reward
      growth.rewards.fire({ userId: inviteeId, reason: "referral-invitee", meta: { inviterId: edge.inviterId } });
      return void json(res, 201, { ok: true, edge, signupBonus: r.entry });
    }

    // ---- /api/referrals/activate -------------------------------------
    if (path === "/api/referrals/activate" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const inviteeId = String(body["inviteeId"] ?? "");
      const edge = growth.referrals.markActivated(inviteeId);
      if (!edge) return void json(res, 404, { ok: false, error: { code: "no_referral" } });
      growth.retention.activity(inviteeId);
      // fire inviter reward + first-ai-call bonus
      const inviterReward = growth.rewards.fire({
        userId: edge.inviterId,
        reason: "referral-activated",
        meta: { inviteeId },
      });
      const firstAi = growth.rewards.fire({ userId: inviteeId, reason: "first-ai-call" });
      return void json(res, 200, { ok: true, edge, inviterReward: inviterReward.entry, firstAiBonus: firstAi.entry });
    }

    // ---- /api/referrals/stats/:inviterId ------------------------------
    const refStatsMatch = path.match(/^\/api\/referrals\/stats\/([^/]+)$/);
    if (refStatsMatch && method === "GET") {
      return void json(res, 200, { ok: true, stats: growth.referrals.stats(refStatsMatch[1]!) });
    }

    // ---- POST /api/contributions --------------------------------------
    if (path === "/api/contributions" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const kind = String(body["kind"] ?? "") as ContributionKind;
      const contributorId = String(body["contributorId"] ?? "");
      const title = String(body["title"] ?? "");
      const artifact = String(body["artifact"] ?? "");
      if (!kind || !contributorId || !title || !artifact) {
        return void json(res, 400, { ok: false, error: { code: "invalid_input" } });
      }
      const c = growth.contributions.submit({ kind, contributorId, title, artifact });
      return void json(res, 201, { ok: true, contribution: c });
    }

    // ---- POST /api/contributions/:id/verify ---------------------------
    const verifyMatch = path.match(/^\/api\/contributions\/([^/]+)\/verify$/);
    if (verifyMatch && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const accept = body["accept"] === true;
      const notes = typeof body["notes"] === "string" ? (body["notes"] as string) : undefined;
      const rep = Number(body["contributorReputation"] ?? 0);
      try {
        const c = growth.contributions.verify(verifyMatch[1]!, accept, notes, rep);
        // Issue points to contributor
        if (c.rewardIssued > 0) {
          growth.ledger.issue(c.contributorId, c.rewardIssued, {
            reason: "tool-contribution",
            context: { contributionId: c.id },
            idempotencyKey: `contribution:${c.id}`,
          });
        }
        return void json(res, 200, { ok: true, contribution: c });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("contribution_not_found")) {
          return void json(res, 404, { ok: false, error: { code: "not_found" } });
        }
        throw e;
      }
    }

    // ---- POST /api/contributions/:id/use ------------------------------
    const useMatch = path.match(/^\/api\/contributions\/([^/]+)\/use$/);
    if (useMatch && method === "POST") {
      const c = growth.contributions.recordUsage(useMatch[1]!);
      if (!c) return void json(res, 404, { ok: false, error: { code: "not_found" } });
      // milestone bonus flows through the ledger
      if (c.status === "verified" && c.usageCount > 0 && c.usageCount % 100 === 0) {
        growth.ledger.issue(c.contributorId, 10, {
          reason: "tool-contribution",
          context: { contributionId: c.id, usageMilestone: c.usageCount },
        });
      }
      return void json(res, 200, { ok: true, contribution: c });
    }

    // ---- GET /api/contributions ---------------------------------------
    if (path === "/api/contributions" && method === "GET") {
      const contributorId = url.searchParams.get("contributorId") ?? undefined;
      const kind = (url.searchParams.get("kind") as ContributionKind | null) ?? undefined;
      const status = url.searchParams.get("status") as "pending" | "verified" | "rejected" | null;
      const list = growth.contributions.list({ contributorId, kind, status: status ?? undefined });
      return void json(res, 200, { ok: true, contributions: list });
    }

    // ---- GET /api/growth/stats ----------------------------------------
    if (path === "/api/growth/stats" && method === "GET") {
      return void json(res, 200, {
        ok: true,
        retention: growth.retention.stats(),
        pointUsers: growth.ledger.listUsers().length,
      });
    }

    // ---- POST /api/growth/signup --------------------------------------
    if (path === "/api/growth/signup" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      growth.retention.signup(String(body["userId"] ?? ""));
      return void json(res, 200, { ok: true });
    }

    // ---- POST /api/growth/activity ------------------------------------
    if (path === "/api/growth/activity" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      growth.retention.activity(String(body["userId"] ?? ""));
      return void json(res, 200, { ok: true });
    }

    return void json(res, 404, { ok: false, error: { code: "not_found", message: `no route for ${method} ${path}` } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal_error";
    const code = message === "invalid_json" ? "invalid_json" : "internal_error";
    return void json(res, code === "invalid_json" ? 400 : 500, { ok: false, error: { code, message } });
  }
}
