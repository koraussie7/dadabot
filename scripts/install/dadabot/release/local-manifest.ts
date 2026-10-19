#!/usr/bin/env -S node --no-warnings
/**
 * local-manifest.ts — generates latest-*.json from local dist/ directory
 * Mirrors what release.yml's "Build static manifest" step does.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DISPLAY: Record<string, string> = {
  "macos-universal":   "macOS (Universal: Intel + Apple Silicon)",
  "macos-aarch64":     "macOS (Apple Silicon)",
  "macos-x86_64":      "macOS (Intel)",
  "linux-x86_64":      "Linux (x86_64 GNU)",
  "linux-x86_64-musl": "Linux (x86_64 musl)",
  "linux-aarch64":     "Linux (ARM64)",
  "windows-x86_64":    "Windows (x86_64)",
};

function parseArgs(argv: string[]): {
  version: string; channel: "stable"|"beta"|"nightly"; dist: string;
  out: string; pubkey?: string; baseUrl?: string;
} {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) (out as Record<string,string>)[arg.slice(2)] = argv[++i];
  }
  if (!out.version) throw new Error("--version required");
  if (!out.dist) throw new Error("--dist required");
  if (!out.out) throw new Error("--out required");
  return {
    version: out.version,
    channel: (out.channel as "stable"|"beta"|"nightly") ?? "stable",
    dist: out.dist, out: out.out,
    pubkey: out.pubkey,
    baseUrl: out.baseUrl ?? "https://github.com/dadabot-ai/dadabot/releases/download",
  };
}

async function sha256(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs([here, ...process.argv.slice(2)]);
  const platformDirs = await readdir(args.dist);
  const platforms: Record<string, unknown> = {};

  for (const dirName of platformDirs) {
    const dirPath = join(args.dist, dirName);
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) continue;
    const files = await readdir(dirPath);
    const archive = files.find((f) => f.endsWith(".tar.gz") || f.endsWith(".zip"));
    if (!archive) continue;
    const archivePath = join(dirPath, archive);
    const hash = await sha256(archivePath);
    const size = (await stat(archivePath)).size;
    const downloadUrl = `${args.baseUrl}/v${args.version}/${archive}`;
    const sigUrl = `${downloadUrl}.sig`;
    const suffix = dirName.replace(/^dadabot-/, "");
    platforms[suffix] = {
      display_name: DISPLAY[suffix] ?? suffix,
      asset: archive,
      download_url: downloadUrl,
      signature_url: sigUrl,
      sha256: hash,
      size_bytes: size,
    };
  }

  const manifest = {
    channel: args.channel,
    version: args.version,
    published_at: new Date().toISOString().replace(/\..+/, "Z"),
    minisign_pubkey: args.pubkey ?? "RWQqHXfRYzE7kBvK1Lm8Np2Qs5Tv4Wx9Yz6A3F7G0Bc2D5E8H1J4M6N9P1R3S5T7V",
    platforms,
  };

  await writeFile(args.out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[local-manifest] wrote ${args.out} — ${Object.keys(platforms).length} platforms`);
  for (const [p, info] of Object.entries(platforms)) {
    const i = info as { size_bytes: number };
    console.log(`  • ${p.padEnd(20)} ${(i.size_bytes / 1024 / 1024).toFixed(2)} MB`);
  }
}

main().catch((err) => {
  console.error("[local-manifest] ERROR:", err);
  process.exit(1);
});
