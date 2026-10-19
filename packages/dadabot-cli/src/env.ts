/**
 * env.ts — environment configuration for the CLI.
 *
 * Resolves:
 *   - DADABOT_HOME      (default $HOME/.dadabot)
 *   - DADABOT_VERSION   (default 0.1.0-beta.1)
 *   - DADABOT_DRY_RUN   (default false)
 *   - DADABOT_INBOX_FILE  (default $DADABOT_HOME/inbox.json)
 *
 * In production, the inbox is persisted as JSON to ~/.dadabot/inbox.json.
 * In tests, an in-memory inbox is used via the override hooks below.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

export interface DadabotEnv {
  home: string;
  inboxFile: string;
  auditFile: string;
  workspaceId: string;
  version: string;
  dryRun: boolean;
  /** Actor name written into audit trail; defaults to $USER */
  actor: string;
}

/**
 * Load ~/.dadabot/.env into process.env (one-shot per process).
 * Format: KEY=value per line, # for comments, no quoting required.
 * Idempotent — safe to call multiple times; only acts once.
 * Does NOT override existing process.env values (CLI/env wins).
 */
let dotenvLoaded = false;
export function loadDotenv(home: string = join(homedir(), ".dadabot")): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const envFile = join(home, ".env");
  if (!existsSync(envFile)) return;
  try {
    const text = readFileSync(envFile, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Tolerate corrupt .env files
  }
}

export function loadEnv(overrides: Partial<DadabotEnv> = {}): DadabotEnv {
  const home = overrides.home ?? process.env["DADABOT_HOME"] ?? join(homedir(), ".dadabot");
  loadDotenv(home);
  const inboxFile = overrides.inboxFile ?? join(home, "inbox.json");
  const auditFile = overrides.auditFile ?? join(home, "audit.jsonl");
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 });
  return {
    home,
    inboxFile,
    auditFile,
    workspaceId: process.env["DADABOT_WORKSPACE"] ?? "dadabot-cli",
    version: process.env["DADABOT_VERSION"] ?? "0.1.0-beta.1",
    dryRun: process.env["DADABOT_DRY_RUN"] === "1" || (overrides.dryRun ?? false),
    actor: process.env["USER"] ?? process.env["USERNAME"] ?? "cli-user",
    ...overrides,
  };
}

export function formatTable(rows: string[][], widths?: number[]): string {
  if (rows.length === 0) return "";
  const cols = rows[0]!.length;
  const w: number[] = widths ?? Array.from({ length: cols }, (_, c) =>
    rows.reduce((m, r) => Math.max(m, (r[c] ?? "").length), 0),
  );
  return rows
    .map((r) => r.map((cell, i) => (cell ?? "").padEnd(w[i] ?? 0)).join("  "))
    .join("\n");
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
