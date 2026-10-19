/**
 * audit.ts — Append-only audit log.
 *
 * In busabase, every action is recorded in a local SQLite WAL. Dadabot mirrors
 * this with a structured JSONL append-only log + optional S3/HTTP forwarder.
 *
 * Use cases:
 *   - regulator / compliance review
 *   - "Why did the AI do X?" debugging
 *   - rolling back unsafe auto-merged actions
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ChangeRequest, AuditEntry } from "./change-request.ts";

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
  logChangeRequest(cr: ChangeRequest, action: string, actor: string): Promise<void>;
  flush(): Promise<void>;
}

export function createFileAuditLogger(path: string): AuditLogger {
  const absolute = resolve(path);
  const queue: AuditEntry[] = [];
  let writing = false;

  async function drain(): Promise<void> {
    if (writing || queue.length === 0) return;
    writing = true;
    try {
      await mkdir(dirname(absolute), { recursive: true });
      const lines = queue.splice(0, queue.length).map((e) => JSON.stringify(e)).join("\n") + "\n";
      await appendFile(absolute, lines, "utf8");
    } finally {
      writing = false;
    }
  }

  return {
    async log(entry) {
      queue.push(entry);
      await drain();
    },
    async logChangeRequest(cr, action, actor) {
      const entry: AuditEntry = {
        at: new Date().toISOString(),
        actor,
        action,
        detail: `cr=${cr.id} status=${cr.status}`,
      };
      queue.push(entry);
      await drain();
    },
    async flush() {
      await drain();
    },
  };
}

export function createMemoryAuditLogger(): AuditLogger & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    async log(entry) {
      entries.push(entry);
    },
    async logChangeRequest(cr, action, actor) {
      entries.push({
        at: new Date().toISOString(),
        actor,
        action,
        detail: `cr=${cr.id} status=${cr.status}`,
      });
    },
    async flush() {
      // no-op
    },
  };
}
