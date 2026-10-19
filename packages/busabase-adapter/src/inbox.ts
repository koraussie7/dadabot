/**
 * inbox.ts — Human review queue.
 *
 * Mirrors busabase's Inbox. The local Inbox keeps ChangeRequests in memory
 * (or persisted to SQLite in production) and exposes query/mutation methods
 * used by the Dadabot console UI.
 *
 * In busabase, the Inbox is a separate UI for reviewers. In Dadabot it is
 * accessible both from the web console AND optionally mirrored as GitHub
 * PRs (see ./octokit.ts).
 */

import {
  applyDecision,
  type ChangeRequest,
  type ChangeRequestStatus,
  fingerprint,
  isExpired,
} from "./change-request.ts";

export interface InboxFilter {
  status?: ChangeRequestStatus | ChangeRequestStatus[];
  agent?: string;
  category?: string;
  permission?: "read" | "changeRequest" | "autoMerge";
  sinceHours?: number;
}

export interface Inbox {
  list(filter?: InboxFilter): ChangeRequest[];
  get(id: string): ChangeRequest | undefined;
  getByFingerprint(fp: string): ChangeRequest | undefined;
  add(cr: ChangeRequest): void;
  approve(id: string, actor: string, comment?: string): ChangeRequest;
  reject(id: string, actor: string, comment?: string): ChangeRequest;
  sweepExpired(now?: Date): number;
  size(): number;
}

export function createInbox(opts: {
  persist?: (crs: ChangeRequest[]) => void | Promise<void>;
  load?: () => ChangeRequest[] | Promise<ChangeRequest[]>;
  clock?: () => Date;
} = {}): Inbox {
  const items: ChangeRequest[] = [];
  const clock = opts.clock ?? (() => new Date());

  // Initial load
  if (opts.load) {
    const loaded = opts.load();
    if (loaded instanceof Promise) {
      // Attach a no-op catch to swallow unhandled rejection (Node 26 strict).
      loaded.then((l) => items.push(...l)).catch(() => {});
    } else {
      items.push(...loaded);
    }
  }

  // Synchronous persistence: returns void. Callers invoke `void persist()`
  // which no longer creates an unhandled promise (Node 26 strict check).
  const persist = (): void => {
    if (opts.persist) {
      const r = opts.persist([...items]);
      if (r instanceof Promise) {
        // Attach a no-op catch so Node 26 never sees an unhandled rejection.
        r.catch(() => {});
      }
    }
  };

  function matchFilter(cr: ChangeRequest, filter: InboxFilter): boolean {
    if (filter.status) {
      const want = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!want.includes(cr.status)) return false;
    }
    if (filter.agent && cr.agent.name !== filter.agent) return false;
    if (filter.category && cr.category !== filter.category) return false;
    if (filter.permission && cr.policy.permission !== filter.permission) return false;
    if (filter.sinceHours !== undefined) {
      const cutoff = new Date(clock().getTime() - filter.sinceHours * 3600 * 1000);
      if (new Date(cr.createdAt) < cutoff) return false;
    }
    return true;
  }

  return {
    list(filter = {}) {
      return items.filter((cr) => matchFilter(cr, filter));
    },
    get(id) {
      return items.find((cr) => cr.id === id);
    },
    getByFingerprint(fp) {
      return items.find((cr) => fingerprint(cr) === fp);
    },
    add(cr) {
      items.push(cr);
      void persist();
    },
    approve(id, actor, comment) {
      const cr = items.find((c) => c.id === id);
      if (!cr) throw new Error(`ChangeRequest ${id} not found`);
      const next = applyDecision(cr, "approve", actor, comment, clock);
      Object.assign(cr, next);
      void persist();
      return cr;
    },
    reject(id, actor, comment) {
      const cr = items.find((c) => c.id === id);
      if (!cr) throw new Error(`ChangeRequest ${id} not found`);
      const next = applyDecision(cr, "reject", actor, comment, clock);
      Object.assign(cr, next);
      void persist();
      return cr;
    },
    sweepExpired(now = clock()) {
      let count = 0;
      for (const cr of items) {
        if (cr.status === "open" && isExpired(cr, now)) {
          Object.assign(cr, {
            status: "expired" as ChangeRequestStatus,
            updatedAt: now.toISOString(),
          });
          count++;
        }
      }
      if (count > 0) void persist();
      return count;
    },
    size() {
      return items.length;
    },
  };
}
