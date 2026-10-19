/**
 * store.ts — JSON-backed persistent inbox + workspace.
 *
 * The CLI persists ChangeRequests to ~/.dadabot/inbox.json and the
 * affine-adapter workspace to ~/.dadabot/workspace.json. This lets
 * the CLI and the dashboard share state when both run on the same host.
 *
 * Files are read on demand and written on every mutation. For high-
 * frequency updates this would be replaced with SQLite, but JSON is
 * sufficient for human-in-the-loop throughput (single-digit changes
 * per minute).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  createInbox,
  type Inbox,
  type ChangeRequest,
} from "../../busabase-adapter/src/index.ts";
import {
  createWorkspace,
  type Workspace,
  type BlockInstance,
  type SerializedWorkspace,
  DADABOT_SCHEMAS,
} from "../../affine-adapter/src/index.ts";
import type { DadabotEnv } from "./env.ts";

interface InboxSnapshot {
  version: 1;
  requests: ChangeRequest[];
}

export interface PersistentState {
  inbox: Inbox;
  workspace: Workspace;
  load(): void;
  save(): void;
}

export function loadPersistentState(env: DadabotEnv): PersistentState {
  // Inbox + workspace wired with file-backed persistence
  const inbox = createInbox({
    load: () => loadInbox(env.inboxFile),
    persist: (crs) => saveInbox(env.inboxFile, crs),
  });
  const workspace = createWorkspace({
    id: env.workspaceId,
    schema: DADABOT_SCHEMAS,
  });

  const state: PersistentState = {
    inbox,
    workspace,
    load: () => loadWorkspace(env, workspace),
    save: () => saveWorkspace(env, workspace),
  };
  state.load();
  return state;
}

function loadInbox(path: string): ChangeRequest[] {
  if (!existsSync(path)) return [];
  try {
    const txt = readFileSync(path, "utf8");
    const snap: InboxSnapshot = JSON.parse(txt);
    return snap.requests ?? [];
  } catch {
    return [];
  }
}

function saveInbox(path: string, requests: ChangeRequest[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, requests }, null, 2), "utf8");
  renameSync(tmp, path);
}

function loadWorkspace(env: DadabotEnv, workspace: Workspace): void {
  const path = `${env.home}/workspace.json`;
  if (!existsSync(path)) return;
  try {
    const txt = readFileSync(path, "utf8");
    const snap: SerializedWorkspace = JSON.parse(txt);
    workspace.fromJSON(snap);
  } catch {
    // tolerate corrupt file
  }
}

function saveWorkspace(env: DadabotEnv, workspace: Workspace): void {
  const path = `${env.home}/workspace.json`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(workspace.toJSON(), null, 2), "utf8");
  renameSync(tmp, path);
}

/** Save a single block to the workspace (used by `dadabot run`). */
export function appendBlock(env: DadabotEnv, block: BlockInstance): void {
  const state = loadPersistentState(env);
  state.workspace.addBlock(block);
  state.save();
}
