/**
 * rollback.ts — Snapshots and the restore path.
 *
 * Rule from the execution plan (§4): a snapshot that cannot be created means
 * the action must NOT run. Snapshotting failure is never a warning.
 *
 * Charon specifics: `charon.db` is the single source of truth for all routed
 * sites (27 at time of writing). Restoring it requires stopping the container
 * first, otherwise SQLite keeps the old pages open in the WAL.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { InfraAction, InfraActionId } from "./types.ts";

/** Files/dirs that must be captured before an action touches them. */
export const SNAPSHOT_TARGETS: Partial<Record<InfraActionId, readonly string[]>> = {
  "nginx.validate": ["/etc/nginx/sites-enabled", "/etc/nginx/nginx.conf"],
  "nginx.reload": ["/etc/nginx/sites-enabled", "/etc/nginx/nginx.conf"],
  "caddy.validate": ["/etc/caddy/Caddyfile"],
  "service.restart": ["/etc/nginx/sites-enabled", "/opt/charon/charon-data/charon.db"],
  "config.rollback": [],
  "health_check": [],
  "read_logs": [],
  "docker.inspect": [],
  "http.probe": [],
  // Traefik dynamic config is the only file a reload can change; the compose
  // file is captured too so a bad edit is recoverable.
  "traefik.validate": ["/opt/muhanai-traefik-test/dynamic", "/opt/muhanai-traefik-test/compose.yaml"],
  "traefik.reload": ["/opt/muhanai-traefik-test/dynamic", "/opt/muhanai-traefik-test/compose.yaml"],
  "tunnel.status": [],
  "tunnel.restart": ["/etc/cloudflared/muhanai-traefik.yml"],
};

export interface Snapshot {
  id: string;
  actionId: InfraActionId;
  target: string;
  root: string;
  createdAt: number;
  /** Absolute source path → relative path inside `root`. */
  entries: { source: string; stored: string; kind: "file" | "dir" }[];
}

export interface SnapshotOptions {
  /** Where snapshots live. Defaults to /var/backups/muhanai. */
  baseDir?: string;
  /** Injectable clock so tests get deterministic ids. */
  now?: number;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

function defaultBaseDir(): string {
  return process.env.MUHANAI_BACKUP_DIR ?? "/var/backups/muhanai";
}

function snapshotAge(dir: string): number {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

function copyTree(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    }
  }
}

/**
 * Capture everything `action` might modify. Throws SnapshotError if any
 * required path is missing or unreadable — the caller must abort.
 */
export function takeSnapshot(action: InfraAction, options: SnapshotOptions = {}): Snapshot {
  const now = options.now ?? Date.now();
  const baseDir = options.baseDir ?? defaultBaseDir();
  const id = `${now}-${action.id}-${action.target}`.replace(/[^A-Za-z0-9._-]/g, "-");
  const root = resolve(baseDir, id);

  const sources = SNAPSHOT_TARGETS[action.id] ?? [];
  if (sources.length === 0) {
    return { id, actionId: action.id, target: action.target, root, createdAt: now, entries: [] };
  }

  try {
    mkdirSync(root, { recursive: true });
  } catch (err) {
    throw new SnapshotError(`cannot create snapshot dir ${root}: ${(err as Error).message}`);
  }

  const entries: Snapshot["entries"] = [];
  for (const source of sources) {
    if (!existsSync(source)) {
      throw new SnapshotError(`required path missing, refusing to proceed: ${source}`);
    }
    const st = statSync(source);
    const stored = source.replace(/^\//, "");
    const dest = join(root, stored);

    try {
      if (st.isDirectory()) {
        copyTree(source, dest);
        entries.push({ source, stored, kind: "dir" });
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(source, dest);
        entries.push({ source, stored, kind: "file" });
      }
    } catch (err) {
      throw new SnapshotError(`cannot snapshot ${source}: ${(err as Error).message}`);
    }
  }

  const manifest: Snapshot = {
    id,
    actionId: action.id,
    target: action.target,
    root,
    createdAt: now,
    entries,
  };
  writeFileSync(join(root, "snapshot.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

/** Read a manifest back from disk (used by `config.rollback`). */
export function loadSnapshot(root: string): Snapshot {
  const manifestPath = join(root, "snapshot.json");
  if (!existsSync(manifestPath)) {
    throw new SnapshotError(`no snapshot manifest at ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Snapshot;
}

/**
 * Restore a snapshot in place. Best-effort per entry, but reports every
 * failure — a partial restore must never be treated as success.
 */
export function restoreSnapshot(snapshot: Snapshot): { restored: string[]; failed: string[] } {
  const restored: string[] = [];
  const failed: string[] = [];

  for (const entry of snapshot.entries) {
    const from = join(snapshot.root, entry.stored);
    try {
      if (!existsSync(from)) throw new Error("snapshot copy missing");
      if (entry.kind === "dir") {
        rmSync(entry.source, { recursive: true, force: true });
        copyTree(from, entry.source);
      } else {
        mkdirSync(dirname(entry.source), { recursive: true });
        copyFileSync(from, entry.source);
      }
      restored.push(entry.source);
    } catch (err) {
      failed.push(`${entry.source}: ${(err as Error).message}`);
    }
  }

  return { restored, failed };
}

/**
 * Prune snapshots older than `keepDays`. Never deletes the newest snapshot
 * regardless of age, so there is always one restore point.
 */
export function pruneSnapshots(baseDir = defaultBaseDir(), keepDays = 14, now = Date.now()): string[] {
  if (!existsSync(baseDir)) return [];
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d: { isDirectory(): boolean }) => d.isDirectory())
    .map((d: { name: string }) => ({ name: d.name, at: snapshotAge(join(baseDir, d.name)) }))
    .sort((a: { at: number }, b: { at: number }) => b.at - a.at);

  const removed: string[] = [];
  for (const dir of dirs.slice(1)) {
    if (dir.at < cutoff) {
      rmSync(join(baseDir, dir.name), { recursive: true, force: true });
      removed.push(dir.name);
    }
  }
  return removed;
}
