/**
 * rollback.test.ts — snapshot and restore behaviour (plan scenario T3).
 *
 * Uses MUHANAI_BACKUP_DIR overrides against a temp dir; never touches the
 * real /etc/nginx or charon.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSnapshot,
  pruneSnapshots,
  restoreSnapshot,
  SnapshotError,
  takeSnapshot,
} from "../src/rollback.ts";
import type { InfraAction } from "../src/types.ts";

function act(partial: Partial<InfraAction> & Pick<InfraAction, "id">): InfraAction {
  return { target: "proxy01", ...partial } as InfraAction;
}

function scaffold(): { baseDir: string } {
  const baseDir = mkdtempSync(join(tmpdir(), "infra-snap-"));
  return { baseDir };
}

test("actions with no writable targets produce an empty snapshot", () => {
  const { baseDir } = scaffold();
  const snap = takeSnapshot(act({ id: "health_check" }), { baseDir, now: 1 });
  assert.equal(snap.entries.length, 0);
});

test("T3: missing required path aborts with SnapshotError instead of proceeding", () => {
  const { baseDir } = scaffold();
  // nginx.validate declares /etc/nginx/... which does not exist on this host.
  assert.throws(() => takeSnapshot(act({ id: "nginx.validate" }), { baseDir, now: 1 }), SnapshotError);
});

test("snapshot writes a manifest and restores the original bytes", () => {
  const { baseDir } = scaffold();

  // Build a fake tree and point the snapshot at it by patching env-independent
  // paths through a temp action: use read_logs (no targets) plus manual entry.
  const fakeRoot = join(baseDir, "fake-nginx");
  mkdirSync(join(fakeRoot, "sites-enabled"), { recursive: true });
  const conf = join(fakeRoot, "sites-enabled", "muhanai.conf");
  writeFileSync(conf, "server { listen 8080; }\n", "utf8");

  const snap = takeSnapshot(act({ id: "health_check" }), { baseDir, now: 2 });
  // Manually emulate what takeSnapshot does for a real file to test restore.
  snap.entries.push({ source: conf, stored: "fake-nginx/sites-enabled/muhanai.conf", kind: "file" });
  mkdirSync(join(snap.root, "fake-nginx", "sites-enabled"), { recursive: true });
  writeFileSync(join(snap.root, "fake-nginx", "sites-enabled", "muhanai.conf"), "server { listen 8080; }\n", "utf8");
  writeFileSync(join(snap.root, "snapshot.json"), JSON.stringify(snap), "utf8");

  // Break the live config, as a bad deploy would.
  writeFileSync(conf, "this is broken", "utf8");
  assert.equal(readFileSync(conf, "utf8"), "this is broken");

  const manifest = loadSnapshot(snap.root);
  const result = restoreSnapshot(manifest);

  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.restored, [conf]);
  assert.equal(readFileSync(conf, "utf8"), "server { listen 8080; }\n");
});

test("restore reports partial failure rather than pretending success", () => {
  const { baseDir } = scaffold();
  const snap = takeSnapshot(act({ id: "health_check" }), { baseDir, now: 3 });
  snap.entries.push({
    source: join(baseDir, "does-not-exist.conf"),
    stored: "gone.conf",
    kind: "file",
  });

  const result = restoreSnapshot(snap);
  assert.equal(result.restored.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0] ?? "", /snapshot copy missing/);
});

test("loadSnapshot errors clearly when no manifest exists", () => {
  const { baseDir } = scaffold();
  assert.throws(() => loadSnapshot(join(baseDir, "nope")), /no snapshot manifest/);
});

test("prune keeps the newest snapshot even when everything is old", () => {
  const { baseDir } = scaffold();

  // health_check declares no targets, so it writes no directory. Create
  // snapshot dirs directly to exercise the prune ordering.
  for (const now of [1_000, 2_000, 3_000]) {
    mkdirSync(join(baseDir, `${now}-health_check-proxy01`), { recursive: true });
  }
  // Prune with `now` far in the future so every mtime is older than the cutoff.
  const removed = pruneSnapshots(baseDir, 14, Date.now() + 365 * 24 * 3600 * 1000);

  const remaining = existsSync(baseDir)
    ? readdirSync(baseDir).filter((n: string) => !n.startsWith("."))
    : [];
  assert.equal(remaining.length, 1, "newest snapshot must survive pruning");
  assert.deepEqual(removed.sort(), ["1000-health_check-proxy01", "2000-health_check-proxy01"]);
});
