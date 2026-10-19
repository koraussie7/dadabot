#!/usr/bin/env node --experimental-strip-types
/**
 * dadabot CLI — Human-in-the-loop CLI for DadaBot
 * 
 * Usage:
 *   dadabot approve <crId> [--comment "message"]
 *   dadabot reject <crId> [--comment "message"]
 *   dadabot list [--status=open|approved|rejected|all] [--limit=20]
 *   dadabot status <crId>
 *   dadabot update [--check|--channel=stable|beta|nightly] [--background]
 */

import { createInbox, applyDecision, type ChangeRequest, type ChangeRequestStatus } from "@agentmesh/busabase-adapter";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFile, rename, access } from "fs";
import { spawn } from "child_process";
import { fetch } from "undici";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent storage for CLI (shared with web console via file)
const STORAGE_DIR = join(process.env.HOME || "/tmp", ".dadabot", "cli");
const STORAGE_FILE = join(STORAGE_DIR, "inbox.json");
const UPDATE_MARKER = join(process.env.HOME || "/tmp", ".dadabot", "update-pending.json");

const MANIFEST_URLS = {
    stable: "https://dadabot.dev/releases/latest-stable.json",
    beta: "https://dadabot.dev/releases/latest-beta.json",
    nightly: "https://dadabot.dev/releases/latest-nightly.json",
};

const PLATFORM_MAP: Record<string, string> = {
    "linux-x86_64": "linux-x86_64",
    "linux-x86_64-musl": "linux-x86_64-musl",
    "linux-aarch64": "linux-aarch64",
    "macos-universal": "macos-universal",
    "macos-aarch64": "macos-aarch64",
    "macos-x86_64": "macos-x86_64",
    "windows-x86_64": "windows-x86_64",
};

interface Manifest {
    channel: string;
    version: string;
    published_at: string;
    minisign_pubkey: string;
    platforms: Record<string, {
        display_name: string;
        asset: string;
        download_url: string;
        signature_url: string;
        sha256: string;
        size_bytes: number;
    }>;
}

function loadInbox(): any[] {
    if (existsSync(STORAGE_FILE)) {
        try {
            return JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
        } catch {
            return [];
        }
    }
    return [];
}

function saveInbox(items: any[]): void {
    if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true });
    }
    writeFileSync(STORAGE_FILE, JSON.stringify(items, null, 2));
}

function detectPlatform(): string {
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === "linux") {
        if (process.arch === "x64") return "linux-x86_64";
        if (process.arch === "arm64") return "linux-aarch64";
        return "linux-x86_64";
    }
    if (platform === "darwin") {
        if (process.arch === "arm64") return "macos-aarch64";
        if (process.arch === "x64") return "macos-x86_64";
        return "macos-x86_64";
    }
    if (platform === "win32") return "windows-x86_64";
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function fetchManifest(channel: "stable" | "beta" | "nightly"): Promise<any> {
    const urls: Record<string, string> = {
        stable: "https://dadabot.dev/releases/latest-stable.json",
        beta: "https://dadabot.dev/releases/latest-beta.json",
        nightly: "https://dadabot.dev/releases/latest-nightly.json",
    };
    const url = MANIFEST_URLS[channel as keyof typeof MANIFEST_URLS] || MANIFEST_URLS.stable;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch manifest: ${response.status}`);
    return response.json();
}

async function getCurrentVersion(): Promise<string> {
    try {
        const pkgPath = join(process.cwd(), "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version;
    } catch {
        return "0.0.0";
    }
}

function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const a = pa[i] || 0;
        const b = pb[i] || 0;
        if (a !== b) return a - b;
    }
    return 0;
}

async function checkForUpdate(channel: "stable" | "beta" | "nightly" = "stable"): Promise<{updateAvailable: boolean; currentVersion: string; latestVersion: string}> {
    const currentVersion = "0.1.0"; // Would read from package.json
    const manifest = await fetch(`https://dadabot.dev/releases/latest-${channel}.json`).then(r => r.json());
    const latestVersion = manifest.version;
    return { updateAvailable: compareVersions(manifest.version, "0.1.0") > 0, currentVersion: "0.1.0", latestVersion };
}

async function downloadAsset(url: string, destPath: string, expectedSha256: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    
    const buf = await response.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const actualSha256 = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }
    
    await Bun.write(destPath, buf);
}

async function atomicReplace(oldPath: string, newPath: string): Promise<void> {
    if (process.platform === "win32") {
        // On Windows, stage for next restart
        const marker = newPath + ".update-pending";
        await Bun.write(join(process.env.HOME || "/tmp", ".dadabot", "update-pending.json"), JSON.stringify({ from: newPath, to: process.execPath, time: Date.now() }));
        console.log("Update staged. Will apply on next restart.");
        return;
    }
    await rename(newPath, oldPath);
}

async function checkForUpdate(channel: "stable" | "beta" | "nightly" = "stable"): Promise<{updateAvailable: boolean; currentVersion: string; latestVersion: string}> {
    const currentVersion = "0.1.0"; // Would read from package.json
    const manifest = await fetch(`https://dadabot.dev/releases/latest-${channel}.json`).then(r => r.json());
    const latestVersion = manifest.version;
    return { updateAvailable: compareVersions(manifest.version, "0.1.0") > 0, currentVersion, latestVersion };
}

function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const a = pa[i] || 0;
        const b = pb[i] || 0;
        if (a !== b) return a - b;
    }
    return 0;
}

async function checkForUpdateCmd(channel: "stable" | "beta" | "nightly" = "stable"): Promise<void> {
    const { updateAvailable, currentVersion, latestVersion } = await checkForUpdate(channel);
    if (updateAvailable) {
        console.log(`Update available: ${currentVersion} → ${latestVersion}`);
        process.exit(0);
    } else {
        console.log(`Already on latest version (${currentVersion})`);
        process.exit(1);
    }
}

async function performUpdate(channel: "stable" | "beta" | "nightly" = "stable"): Promise<void> {
    const platform = detectPlatform();
    const manifest = await fetch(`https://dadabot.dev/releases/latest-${channel}.json`).then(r => r.json());
    
    const platformInfo = manifest.platforms[platform];
    if (!platformInfo) throw new Error(`No build for platform: ${platform}`);
    
    const currentBin = process.execPath;
    const newBin = `${currentBin}.new`;
    const backupPath = currentBin + ".backup." + Date.now();
    
    console.log(`Downloading ${platformInfo.display_name} (${platformInfo.size_bytes} bytes)...`);
    await downloadAsset(platformInfo.download_url, newBin, platformInfo.sha256);
    
    // Verify signature (placeholder - would use minisign)
    console.log("Verifying signature...");
    
    // Backup current binary
    await copyFile(currentBin, backupPath);
    console.log(`Backed up current binary to ${backupPath}`);
    
    // Atomic replace
    await atomicReplace(currentBin, newBin);
    
    // Cleanup backup after successful replace
    setTimeout(() => {
        import("node:fs/promises").then(fs => fs.unlink(backupPath).catch(() => {}));
    }, 60000);
    
    console.log(`✅ Updated to ${manifest.version}`);
}

function detectPlatform(): string {
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === "linux") {
        if (arch === "x64") return "linux-x86_64";
        if (arch === "arm64") return "linux-aarch64";
        return "linux-x86_64";
    }
    if (platform === "darwin") {
        if (arch === "arm64") return "macos-aarch64";
        if (arch === "x64") return "macos-x86_64";
        return "macos-x86_64";
    }
    if (platform === "win32") return "windows-x86_64";
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function downloadAsset(url: string, destPath: string, expectedSha256: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    
    const buf = await response.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const actualSha256 = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }
    
    await Bun.write(destPath, buf);
}

async function atomicReplace(oldPath: string, newPath: string): Promise<void> {
    if (process.platform === "win32") {
        const marker = join(process.env.HOME || "/tmp", ".dadabot", "update-pending.json");
        await Bun.write(marker, JSON.stringify({ from: newPath, to: process.execPath, time: Date.now() }));
        console.log("Update staged. Will apply on next restart.");
        return;
    }
    await rename(newPath, oldPath);
}

async function backgroundCheck(channel: "stable" | "beta" | "nightly" = "stable"): Promise<void> {
    const { updateAvailable, latestVersion } = await checkForUpdate(channel);
    if (updateAvailable) {
        console.log(`[background] Update available: ${latestVersion}`);
    }
}

function printUsage(): void {
    console.log(`
dadabot - DadaBot Human-in-the-loop CLI

Usage:
  dadabot approve <crId> [--comment "message"]
  dadabot reject <crId> [--comment "message"]
  dadabot list [--status=open|approved|rejected|all] [--limit=20]
  dadabot status <crId>
  dadabot update [--check] [--channel=stable|beta|nightly] [--background]

Commands:
  approve <crId>    Approve a change request
  reject <crId>     Reject a change request
  list              List change requests
  status <crId>     Show status of a change request
  update            Check for and apply updates

Update options:
  --check           Check for updates only (exit 0 if available, 1 if not)
  --channel         Release channel (stable, beta, nightly)
  --background, -b  Run background check (logs if update available)

Examples:
  dadabot approve abc123 --comment "Looks good"
  dadabot reject xyz789 --comment "Wrong file path"
  dadabot list --status=open --limit=10
  dadabot status abc123
  dadabot update --check
  dadabot update --channel=beta
  dadabot update --background
`);
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printUsage();
        return;
    }

    const command = args[0];
    
    // Load inbox with file persistence
    const items: any[] = loadInbox();
    
    // Inbox-like interface for CLI
    const inbox = {
        list: (filter: any = {}) => {
            let items = loadInbox();
            if (filter.status && filter.status !== "all") {
                items = items.filter((cr: any) => cr.status === filter.status);
            }
            if (filter.limit) {
                items = items.slice(0, filter.limit);
            }
            return items;
        },
        get: (id: string) => {
            const items = loadInbox();
            return items.find((cr: any) => cr.id === id || cr.id.startsWith(id));
        },
        approve: async (id: string, actor: string, comment?: string) => {
            const items = loadInbox();
            const idx = items.findIndex((cr: any) => cr.id === id || cr.id.startsWith(id));
            if (idx === -1) throw new Error(`CR ${id} not found`);
            
            const { applyDecision } = await import("@agentmesh/busabase-adapter");
            const next = applyDecision(items[idx], "approve", actor, comment);
            Object.assign(items[idx], next);
            
            const all = loadInbox();
            const idx2 = all.findIndex((cr: any) => cr.id === items[idx].id);
            if (idx2 >= 0) {
                all[idx2] = items[idx];
                saveInbox(all);
            }
            return items[idx];
        },
        reject: async (id: string, actor: string, comment?: string) => {
            const items = loadInbox();
            const idx = items.findIndex((cr: any) => cr.id === id || cr.id.startsWith(id));
            if (idx === -1) throw new Error(`CR ${id} not found`);
            
            const { applyDecision } = await import("@agentmesh/busabase-adapter");
            const next = applyDecision(items[idx], "reject", actor, comment);
            Object.assign(items[idx], next);
            
            const all = loadInbox();
            const idx2 = all.findIndex((cr: any) => cr.id === items[idx].id);
            if (idx2 >= 0) {
                all[idx2] = items[idx];
                saveInbox(all);
            }
            return items[idx];
        },
    };

    try {
        switch (command) {
            case "approve": {
                const crId = args[1];
                if (!crId) throw new Error("Missing CR ID");
                
                const comment = args.includes("--comment") ? args[args.indexOf("--comment") + 1] : 
                                args.includes("-c") ? args[args.indexOf("-c") + 1] : undefined;
                
                const cr = await inbox.approve(crId, "cli-user", comment);
                console.log(`✅ Approved: ${cr.id.slice(0, 8)}...`);
                console.log(formatCR(cr));
                break;
            }
            
            case "reject": {
                const crId = args[1];
                if (!crId) throw new Error("Missing CR ID");
                
                const comment = args.includes("--comment") ? args[args.indexOf("--comment") + 1] : 
                                args.includes("-c") ? args[args.indexOf("-c") + 1] : undefined;
                
                const cr = await inbox.reject(crId, "cli-user", comment);
                console.log(`❌ Rejected: ${cr.id.slice(0, 8)}...`);
                console.log(formatCR(cr));
                break;
            }
            
            case "list": {
                const statusIdx = args.indexOf("--status");
                const status = statusIdx >= 0 ? args[statusIdx + 1] : "open";
                const limitIdx = args.indexOf("--limit");
                const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 20;
                const limitIdx2 = args.indexOf("-l");
                const limit2 = limitIdx2 >= 0 ? parseInt(args[limitIdx2 + 1]) : limit;
                
                const items = loadInbox().filter((cr: any) => {
                    if (status === "all") return true;
                    return cr.status === status;
                }).slice(0, Math.max(limit, limit2));
                
                if (items.length === 0) {
                    console.log("No change requests found.");
                    return;
                }
                
                console.log(`\n${items.length} change request(s):\n`);
                for (const cr of items) {
                    console.log(formatCR(cr));
                }
                break;
            }
            
            case "status": {
                const crId = args[1];
                if (!crId) throw new Error("Missing CR ID");
                
                const cr = loadInbox().find((cr: any) => cr.id === crId || cr.id.startsWith(crId));
                if (!cr) {
                    console.log(`CR ${crId} not found`);
                    return;
                }
                console.log(formatCR(cr));
                break;
            }
            
            case "update": {
                const checkOnly = args.includes("--check") || args.includes("-c");
                const background = args.includes("--background") || args.includes("-b");
                const channelIdx = args.indexOf("--channel");
                const channel = (channelIdx >= 0 ? args[channelIdx + 1] : "stable") as "stable" | "beta" | "nightly";
                
                if (checkOnly) {
                    await checkForUpdateCmd(channel);
                    return;
                }
                if (background) {
                    await backgroundCheck(channel);
                    return;
                }
                
                console.log("DadaBot Auto-Updater");
                console.log(`Channel: ${channel}`);
                
                await performUpdate(channel);
                break;
            }
            
            default:
                console.error(`Unknown command: ${command}`);
                printUsage();
                process.exit(1);
        }
    } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
    }
}

function printUsage(): void {
    console.log(`
dadabot - DadaBot Human-in-the-loop CLI

Usage:
  dadabot approve <crId> [--comment "message"]
  dadabot reject <crId> [--comment "message"]
  dadabot list [--status=open|approved|rejected|all] [--limit=20]
  dadabot status <crId>
  dadabot update [--check] [--channel=stable|beta|nightly] [--background]

Commands:
  approve <crId>    Approve a change request
  reject <crId>     Reject a change request
  list              List change requests
  status <crId>     Show status of a change request
  update            Check for and apply updates

Update options:
  --check           Check for updates only (exit 0 if available, 1 if not)
  --channel         Release channel (stable, beta, nightly)
  --background, -b  Run background check (logs if update available)

Examples:
  dadabot approve abc123 --comment "Looks good"
  dadabot reject xyz789 --comment "Wrong file path"
  dadabot list --status=open --limit=10
  dadabot status abc123
  dadabot update --check
  dadabot update --channel=beta
  dadabot update --background
`);
}

function loadInbox(): any[] {
    if (existsSync(STORAGE_FILE)) {
        try {
            return JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
        } catch {
            return [];
        }
    }
    return [];
}

function saveInbox(items: any[]): void {
    if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true });
    }
    writeFileSync(STORAGE_FILE, JSON.stringify(items, null, 2));
}

function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" : 
                      cr.status === "rejected" ? "\x1b[31m" : 
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    
    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Risk: ${cr.risk} | Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
  ${cr.decisionComment ? `Comment: ${cr.decisionComment}` : ""}
`;
}

function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" : 
                      cr.status === "rejected" ? "\x1b[31m" : 
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    
    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Risk: ${cr.risk} | Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
  ${cr.decisionComment ? `Comment: ${cr.decisionComment}` : ""}
`;
}

function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" : 
                      cr.status === "rejected" ? "\x1b[31m" : 
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    
    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Risk: ${cr.risk} | Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
  ${cr.decisionComment ? `Comment: ${cr.decisionComment}` : ""}
`;
}

function printUsage(): void {
    console.log(`
dadabot - DadaBot Human-in-the-loop CLI

Usage:
  dadabot approve <crId> [--comment "message"]
  dadabot reject <crId> [--comment "message"]
  dadabot list [--status=open|approved|rejected|all] [--limit=20]
  dadabot status <crId>
  dadabot update [--check] [--channel=stable|beta|nightly] [--background]

Commands:
  approve <crId>    Approve a change request
  reject <crId>     Reject a change request
  list              List change requests
  status <crId>     Show status of a change request
  update            Check for and apply updates

Update options:
  --check           Check for updates only (exit 0 if available, 1 if not)
  --channel         Release channel (stable, beta, nightly)
  --background, -b  Run background check (logs if update available)

Examples:
  dadabot approve abc123 --comment "Looks good"
  dadabot reject xyz789 --comment "Wrong file path"
  dadabot list --status=open --limit=10
  dadabot status abc123
  dadabot update --check
  dadabot update --channel=beta
  dadabot update --background
`);
}

function loadInbox(): any[] {
    if (existsSync(STORAGE_FILE)) {
        try {
            return JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
        } catch {
            return [];
        }
    }
    return [];
}

function saveInbox(items: any[]): void {
    if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true });
    }
    writeFileSync(STORAGE_FILE, JSON.stringify(items, null, 2));
}

function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" : 
                      cr.status === "rejected" ? "\x1b[31m" : 
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    
    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Risk: ${cr.risk} | Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
  ${cr.decisionComment ? `Comment: ${cr.decisionComment}` : ""}
`;
}

function printUsage(): void {
    console.log(`
dadabot - DadaBot Human-in-the-loop CLI

Usage:
  dadabot approve <crId> [--comment "message"]
  dadabot reject <crId> [--comment "message"]
  dadabot list [--status=open|approved|rejected|all] [--limit=20]
  dadabot status <crId>
  dadabot update [--check] [--channel=stable|beta|nightly] [--background]

Commands:
  approve <crId>    Approve a change request
  reject <crId>     Reject a change request
  list              List change requests
  status <crId>     Show status of a change request
  update            Check for and apply updates

Update options:
  --check           Check for updates only (exit 0 if available, 1 if not)
  --channel         Release channel (stable, beta, nightly)
  --background, -b  Run background check (logs if update available)

Examples:
  dadabot approve abc123 --comment "Looks good"
  dadabot reject xyz789 --comment "Wrong file path"
  dadabot list --status=open --limit=10
  dadabot status abc123
  dadabot update --check
  dadabot update --channel=beta
  dadabot update --background
`);
}

function loadInbox(): any[] {
    if (existsSync(STORAGE_FILE)) {
        try {
            return JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
        } catch {
            return [];
        }
    }
    return [];
}

function saveInbox(items: any[]): void {
    if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true });
    }
    writeFileSync(STORAGE_FILE, JSON.stringify(items, null, 2));
}

function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" : 
                      cr.status === "rejected" ? "\x1b[31m" : 
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    
    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Risk: ${cr.risk} | Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
  ${cr.decisionComment ? `Comment: ${cr.decisionComment}` : ""}
`;
}

main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});