/**
 * executor.ts — Applies approved file edits to disk.
 *
 * The executor only runs AFTER the busabase-adapter inbox.approve() flow
 * has completed (i.e. a human — or autoMerge policy — has authorized the
 * action). The executor is pluggable so tests can provide a mock that
 * just records the calls.
 */

import { mkdir, writeFile, unlink, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ProposalFileChange } from "./proposal.ts";

export interface ExecutorResult {
  path: string;
  operation: ProposalFileChange["operation"];
  bytesWritten?: number;
}

export interface FileSystemExecutor {
  apply(files: ProposalFileChange[], options?: { root?: string }): Promise<ExecutorResult[]>;
}

/**
 * Production executor — actually writes/deletes files on disk.
 *
 * Used by:
 *   - dadabot CLI (`dadabot apply <crId>`)
 *   - busabase-adapter autoMerge path
 *
 * Restricts writes to a `root` directory for safety.
 */
export function createFileSystemExecutor(root: string = process.cwd()): FileSystemExecutor {
  const safeRoot = resolve(root);
  return {
    async apply(files, options) {
      const base = resolve(options?.root ?? safeRoot);
      const out: ExecutorResult[] = [];
      for (const file of files) {
        const fullPath = resolve(base, file.path);
        if (!fullPath.startsWith(safeRoot) && !fullPath.startsWith(base)) {
          throw new Error(`Refusing to write outside root: ${file.path}`);
        }
        switch (file.operation) {
          case "create":
          case "modify": {
            if (file.content === undefined) {
              throw new Error(`Missing content for ${file.path}`);
            }
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, file.content, "utf8");
            out.push({ path: file.path, operation: file.operation, bytesWritten: Buffer.byteLength(file.content, "utf8") });
            break;
          }
          case "delete": {
            await unlink(fullPath).catch(() => {
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

/**
 * Test executor — records calls without touching disk.
 */
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

/**
 * Rename executor helper — wraps node:fs/promises rename.
 * Used for file moves that show up as delete + create pairs.
 */
export async function safeRename(from: string, to: string): Promise<void> {
  await mkdir(dirname(resolve(to)), { recursive: true });
  await rename(resolve(from), resolve(to));
}
