// Browser-safe stub for node:fs/promises and node:path.
// These modules are only used by Dadabot's Node-only executors/audit loggers,
// which are never called from the browser dashboard.
export const appendFile = async () => { /* no-op */ };
export const mkdir = async () => { /* no-op */ };
export const writeFile = async () => { /* no-op */ };
export const unlink = async () => { /* no-op */ };
export const rename = async () => { /* no-op */ };
export const dirname = (p: string) => p;
export const resolve = (...args: string[]) => args.join("/");
export const stat = async () => ({}) as any;
export const readdir = async () => [] as string[];
