/**
 * inbox-sqlite.ts — durable Inbox backend.
 *
 * WHY: `store.ts` in dadabot-cli persists the inbox by rewriting the entire
 * `inbox.json` on every mutation. Two processes (the CLI approving a request
 * while the dashboard rejects another) each read the file, mutate their own
 * copy, and write it back — the later writer silently drops the earlier one.
 *
 * This backend makes every mutation a single SQLite transaction, so concurrent
 * writers serialise instead of clobbering. It uses `node:sqlite` (Node 22+),
 * so there is no native dependency to build on the VPS.
 *
 * API-compatible with createInbox() from ./inbox.ts, minus the load/persist
 * hooks (the database IS the persistence).
 */
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { applyDecision, fingerprint, isExpired } from "./change-request.ts";
import type {
  ChangeRequest,
  ChangeRequestStatus,
} from "./change-request.ts";
import type { Inbox, InboxFilter } from "./inbox.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS change_requests (
  id              TEXT PRIMARY KEY,
  fingerprint     TEXT NOT NULL,
  status          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  category        TEXT NOT NULL,
  permission      TEXT NOT NULL,
  confidence      REAL NOT NULL,
  title           TEXT NOT NULL,
  document        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cr_status     ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_cr_agent      ON change_requests(agent_name);
CREATE INDEX IF NOT EXISTS idx_cr_fp         ON change_requests(fingerprint);
CREATE INDEX IF NOT EXISTS idx_cr_created    ON change_requests(created_at);
`;

export interface SqliteInboxOptions {
  /** Path to the .db file. ":memory:" is allowed for tests. */
  path: string;
  /** Clock override, mainly for expiry tests. */
  clock?: () => Date;
}

export interface SqliteInbox extends Inbox {
  close(): void;
  /** Exposed for migration bookkeeping and tests. */
  readonly path: string;
}

type Row = {
  id: string;
  fingerprint: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  agent_name: string;
  category: string;
  permission: string;
  confidence: number;
  title: string;
  document: string;
};

export function createSqliteInbox(options: SqliteInboxOptions): SqliteInbox {
  const { path } = options;
  const clock = options.clock ?? (() => new Date());

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  // WAL lets a reader (dashboard list) proceed while the CLI writes.
  // busy_timeout makes a second writer wait instead of throwing SQLITE_BUSY.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT INTO change_requests
       (id, fingerprint, status, created_at, updated_at, expires_at,
        agent_name, category, permission, confidence, title, document)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const updateStmt = db.prepare(
    `UPDATE change_requests
        SET status = ?, updated_at = ?, document = ?
      WHERE id = ?`,
  );
  const selectAll = db.prepare(`SELECT * FROM change_requests`);
  const selectById = db.prepare(`SELECT * FROM change_requests WHERE id = ?`);
  const selectByFp = db.prepare(`SELECT * FROM change_requests WHERE fingerprint = ?`);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM change_requests`);

  function rowToCr(row: Row): ChangeRequest {
    return JSON.parse(row.document) as ChangeRequest;
  }

  function writeCr(cr: ChangeRequest): void {
    insertStmt.run(
      cr.id,
      fingerprint(cr),
      cr.status,
      cr.createdAt,
      cr.updatedAt,
      cr.expiresAt,
      cr.agent.name,
      cr.category,
      cr.policy.permission,
      cr.confidence,
      cr.title,
      JSON.stringify(cr),
    );
  }

  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function matches(cr: ChangeRequest, filter: InboxFilter): boolean {
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

  const inbox: SqliteInbox = {
    path,

    list(filter = {}) {
      // Push the cheap, indexed predicates into SQL; do the rest in JS so the
      // filter semantics stay byte-identical to createInbox().
      const statuses = filter.status
        ? Array.isArray(filter.status)
          ? filter.status
          : [filter.status]
        : undefined;

      let rows = selectAll.all() as Row[];
      if (statuses) {
        const allowed = new Set(statuses);
        rows = rows.filter((r) => allowed.has(r.status as ChangeRequestStatus));
      }
      if (filter.agent) rows = rows.filter((r) => r.agent_name === filter.agent);
      if (filter.category) rows = rows.filter((r) => r.category === filter.category);
      if (filter.permission) rows = rows.filter((r) => r.permission === filter.permission);

      return rows.map(rowToCr).filter((cr) => matches(cr, filter));
    },

    get(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? rowToCr(row) : undefined;
    },

    getByFingerprint(fp) {
      const row = selectByFp.get(fp) as Row | undefined;
      return row ? rowToCr(row) : undefined;
    },

    add(cr) {
      // ON CONFLICT DO NOTHING: re-adding the same CR is a no-op rather than
      // an error, matching the in-memory inbox's idempotent add.
      writeCr(cr);
    },

    approve(id, actor, comment) {
      return transaction(() => {
        const row = selectById.get(id) as Row | undefined;
        if (!row) throw new Error(`ChangeRequest ${id} not found`);
        const next = applyDecision(rowToCr(row), "approve", actor, comment, clock);
        updateStmt.run(next.status, next.updatedAt, JSON.stringify(next), id);
        return next;
      });
    },

    reject(id, actor, comment) {
      return transaction(() => {
        const row = selectById.get(id) as Row | undefined;
        if (!row) throw new Error(`ChangeRequest ${id} not found`);
        const next = applyDecision(rowToCr(row), "reject", actor, comment, clock);
        updateStmt.run(next.status, next.updatedAt, JSON.stringify(next), id);
        return next;
      });
    },

    sweepExpired(now = clock()) {
      return transaction(() => {
        const rows = selectAll.all() as Row[];
        let count = 0;
        for (const row of rows) {
          const cr = rowToCr(row);
          if (cr.status === "open" && isExpired(cr, now)) {
            const next: ChangeRequest = {
              ...cr,
              status: "expired" as ChangeRequestStatus,
              updatedAt: now.toISOString(),
            };
            updateStmt.run(next.status, next.updatedAt, JSON.stringify(next), cr.id);
            count++;
          }
        }
        return count;
      });
    },

    size() {
      const row = countStmt.get() as { n: number };
      return row.n;
    },

    close() {
      db.close();
    },
  };

  return inbox;
}

/**
 * Import ChangeRequests produced by the legacy JSON store.
 *
 * Idempotent: the primary key is the CR id, and INSERT ... ON CONFLICT DO
 * NOTHING means a second run imports nothing. Returns how many rows were new.
 */
export function migrateJsonInbox(inbox: SqliteInbox, legacy: readonly ChangeRequest[]): number {
  const before = inbox.size();
  for (const cr of legacy) {
    inbox.add(cr);
  }
  return inbox.size() - before;
}
