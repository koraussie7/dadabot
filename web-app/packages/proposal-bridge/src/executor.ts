/**
 * executor.ts — Applies approved file edits to disk.
 *
 * The executor only runs AFTER the busabase-adapter inbox.approve() flow
 * has completed (i.e. a human — or autoMerge policy — has authorized the
 * action). The executor is pluggable so tests can provide a mock that
 * just records the calls.
 *
 * Browser-safe: node:fs/promises is lazily imported (only createFileSystemExecutor
 * uses it, and it is never called from the browser). node:path is replaced with
 * pure-JS posix helpers so vite can bundle this file for the browser.
 */

import type { ProposalFileChange } from "./proposal.ts";

// ---------------------------------------------------------------------------
// Pure-JS posix path helpers (no node:path dependency)
// ---------------------------------------------------------------------------

function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

function posixResolve(...parts: string[]): string {
  let resolved = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("/")) {
      resolved = p;
      break;
    }
    resolved = p.replace(/\/+$/, "") + "/" + resolved.replace(/^\/+/, "");
  }
  resolved = resolved.replace(/\/+/g, "/");
  const segments: string[] = [];
  for (const seg of resolved.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return segments.join("/") || ".";
}

// ---------------------------------------------------------------------------
// Lazy Node.js fs (never eagerly imported; browser-safe)
// ---------------------------------------------------------------------------

let _fs: any = null;
async function nodeFS(): Promise<any> {
  if (!_fs) _fs = await import("node:fs/promises");
  return _fs;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExecutorResult {
  path: string;
  operation: ProposalFileChange["operation"];
  bytesWritten?: number;
}

export interface FileSystemExecutor {
  apply(files: ProposalFileChange[], options?: { root?: string }): Promise<ExecutorResult[]>;
}

// ---------------------------------------------------------------------------
// Production executor — actually writes/deletes files on disk.
// Used by:
//   - dadabot CLI (`dadabot apply <crId>`)
//   - busabase-adapter autoMerge path
// Restricts writes to a `root` directory for safety.
// ---------------------------------------------------------------------------

export function createFileSystemExecutor(root: string = process.cwd()): FileSystemExecutor {
  const safeRoot = posixResolve(root);
  return {
    async apply(files, options) {
      const fs = await nodeFS();
      const base = posixResolve(options?.root ?? safeRoot);
      const out: ExecutorResult[] = [];
      for (const file of files) {
        const fullPath = posixResolve(base, file.path);
        if (!fullPath.startsWith(safeRoot) && !fullPath.startsWith(base)) {
          throw new Error(`Refusing to write outside root: ${file.path}`);
        }
        switch (file.operation) {
          case "create":
          case "modify": {
            if (file.content === undefined) {
              throw new Error(`Missing content for ${file.path}`);
            }
            await fs.mkdir(posixDirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, file.content, "utf8");
            out.push({
              path: file.path,
              operation: file.operation,
              bytesWritten: Buffer.byteLength(file.content, "utf8"),
            });
            break;
          }
          case "delete": {
            await fs.unlink(fullPath).catch(() => {
              /* tolerate missing files */
            });
            out.push({ path: file.path, operation: "delete" });
            break;
          }
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Test executor — records calls without touching disk.
// ---------------------------------------------------------------------------

export function createRecordingExecutor(): FileSystemExecutor & { calls: ProposalFileChange[][] } {
  const calls: ProposalFileChange[][] = [];
  return {
    calls,
    async apply(files) {
      calls.push(files);
      return files.map((f) => ({
        path: f.path,
        operation: f.operation,
        bytesWritten: f.content ? Buffer.byteLength(f.content, "utf8") : undefined,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Rename executor helper — wraps node:fs/promises rename.
// Used for file moves that show up as delete + create pairs.
// ---------------------------------------------------------------------------

export async function safeRename(from: string, to: string): Promise<void> {
  const fs = await nodeFS();
  await fs.mkdir(posixDirname(posixResolve(to)), { recursive: true });
  await fs.rename(posixResolve(from), posixResolve(to));
}
