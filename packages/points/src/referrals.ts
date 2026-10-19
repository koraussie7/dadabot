// referrals.ts — Direct-invite graph with anti-gaming guard rails.
//
// Strategy: "Direct referral centered, not multi-level."
// - inviter gets 300 points ONLY when the referee actually activates
//   (defined as: completes their first AI call within 7 days of signup).
// - invitee gets 100 points on signup.
// - inviter gets additional 50 points when referee hits the activation threshold.

import { randomUUID } from "node:crypto";

export interface ReferralEdge {
  id: string;
  inviterId: string;          // who referred
  inviteeId: string;          // who signed up via that link
  inviteCode: string;         // human-readable code used at signup
  createdAt: number;          // when invitee signed up
  activated: boolean;         // referee completed first AI call?
  activatedAt?: number;
}

export interface ReferralStats {
  inviterId: string;
  totalInvites: number;
  activated: number;
  pending: number;
  activationRate: number;     // 0..1
  /** Anti-gaming signal: invites from same IP / device fingerprint cluster. */
  clusterCount: number;
}

export interface ReferralGraph {
  /** Issue an invite code for an inviter (or return existing one). */
  ensureCode(inviterId: string): string;
  /** Record that invitee signed up using code. */
  recordSignup(inviteeId: string, inviteCode: string): ReferralEdge;
  /** Mark an invitee's first AI call (activation). */
  markActivated(inviteeId: string, ts?: number): ReferralEdge | undefined;
  /** Get all edges where this user is inviter. */
  invitesBy(inviterId: string): ReferralEdge[];
  /** Aggregate stats for an inviter. */
  stats(inviterId: string): ReferralStats;
  /** Anti-gaming: cluster edges by IP/device (test/admin tool). */
  setCluster(edgeId: string, clusterId: string): void;
  reset(): void;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I for readability

function shortCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function createReferralGraph(): ReferralGraph {
  const byCode = new Map<string, ReferralEdge>();
  const byInvitee = new Map<string, ReferralEdge>();
  const codeByInviter = new Map<string, string>();
  const clusterOf = new Map<string, string>(); // edgeId → clusterId
  let monotonicSeq = 0;

  return {
    ensureCode(inviterId) {
      const existing = codeByInviter.get(inviterId);
      if (existing) return existing;
      let code = shortCode();
      while (byCode.has(code)) code = shortCode();
      codeByInviter.set(inviterId, code);
      return code;
    },

    recordSignup(inviteeId, inviteCode) {
      monotonicSeq++;
      const edge: ReferralEdge = {
        id: randomUUID(),
        inviterId: byInvitee.has(inviteeId) ? byInvitee.get(inviteeId)!.inviterId : "",
        inviteeId,
        inviteCode,
        createdAt: Date.now() + monotonicSeq, // monotonic for stable sort
        activated: false,
      };
      // find inviter from code (in real impl, codes are stored externally)
      // here we reverse-lookup via codeByInviter values
      for (const [inviter, c] of codeByInviter.entries()) {
        if (c === inviteCode) {
          edge.inviterId = inviter;
          break;
        }
      }
      byCode.set(inviteCode + ":" + inviteeId, edge);
      byInvitee.set(inviteeId, edge);
      return edge;
    },

    markActivated(inviteeId, ts = Date.now()) {
      const edge = byInvitee.get(inviteeId);
      if (!edge || edge.activated) return edge;
      edge.activated = true;
      edge.activatedAt = ts;
      return edge;
    },

    invitesBy(inviterId) {
      const out: ReferralEdge[] = [];
      for (const e of byInvitee.values()) {
        if (e.inviterId === inviterId) out.push(e);
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },

    stats(inviterId) {
      const edges = this.invitesBy(inviterId);
      const activated = edges.filter((e) => e.activated).length;
      // cluster: count unique clusterIds among this inviter's edges
      const clusters = new Set<string>();
      for (const e of edges) {
        const c = clusterOf.get(e.id);
        if (c) clusters.add(c);
      }
      return {
        inviterId,
        totalInvites: edges.length,
        activated,
        pending: edges.length - activated,
        activationRate: edges.length === 0 ? 0 : activated / edges.length,
        clusterCount: clusters.size,
      };
    },

    setCluster(edgeId, clusterId) {
      clusterOf.set(edgeId, clusterId);
    },

    reset() {
      byCode.clear();
      byInvitee.clear();
      codeByInviter.clear();
      clusterOf.clear();
    },
  };
}
