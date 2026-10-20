#!/usr/bin/env node --experimental-strip-types
/**
 * dadabot CLI — Human-in-the-loop CLI for DadaBot (web-app bundle entry).
 *
 * Usage:
 *   dadabot approve <crId> [--comment "message"]
 *   dadabot reject <crId> [--comment "message"]
 *   dadabot list [--status=open|approved|rejected|all] [--limit=20]
 *   dadabot status <crId>
 *   dadabot update [--check|--channel=stable|beta|nightly] [--background]
 */

import { applyDecision } from "@agentmesh/busabase-adapter";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fetch } from "undici";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent storage for CLI (shared with web console via file)
const STORAGE_DIR = join(process.env.HOME || "/tmp", ".dadabot", "cli");
const STORAGE_FILE = join(STORAGE_DIR, "inbox.json");

const MANIFEST_URLS = {
    stable: "https://dadabot.dev/releases/latest-stable.json",
    beta: "https://dadabot.dev/releases/latest-beta.json",
    nightly: "https://dadabot.dev/releases/latest-nightly.json",
};

interface Manifest {
    channel: string;
    version: string;
    published_at: string;
    platforms: Record<string, {
        display_name: string;
        asset: string;
        download_url: string;
        sha256: string;
        size_bytes: number;
    }>;
}

function loadInbox(): any[] {
    if (existsSync(STORAGE_FILE)) {
        try {
            return JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
        } catch {
function formatCR(cr: any): string {
    const statusColor = cr.status === "approved" ? "\x1b[32m" :
                      cr.status === "rejected" ? "\x1b[31m" :
                      cr.status === "expired" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";

    return `
${cr.id.slice(0, 8)}...  ${cr.title}
  Status: ${statusColor}${cr.status}${reset} | Agent: ${cr.agent?.name || "unknown"}
  Created: ${new Date(cr.createdAt).toLocaleString()}
  ${cr.rationale ? `Rationale: ${cr.rationale}` : ""}
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
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printUsage();
        return;
    }

    const command = args[0];

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
                const filter: any = {};
                for (let i = 1; i < args.length; i++) {
                    if (args[i].startsWith("--status=")) filter.status = args[i].slice("--status=".length);
                    if (args[i].startsWith("--limit=")) filter.limit = parseInt(args[i].slice("--limit=".length), 10);
                }
                const items = inbox.list(filter);
                if (items.length === 0) {
                    console.log("Inbox is empty.");
                } else {
                    for (const cr of items) {
                        console.log(formatCR(cr));
                    }
                }
                break;
            }
            case "status": {
                const crId = args[1];
                if (!crId) throw new Error("Missing CR ID");
                const cr = inbox.get(crId);
                if (!cr) throw new Error(`CR ${crId} not found`);
                console.log(formatCR(cr));
                break;
            }
            case "update": {
                const channelArg = args.find(a => a.startsWith("--channel="));
                const channel = channelArg ? (channelArg.split("=")[1] as "stable" | "beta" | "nightly") : "stable";
                const res = await fetch(MANIFEST_URLS[channel]);
                if (!res.ok) throw new Error(`Update check failed: ${res.status}`);
                const manifest: Manifest = await res.json();
                console.log(`Latest ${channel}: ${manifest.version}`);
                break;
            }
            default:
                console.error(`error: unknown command '${command}'`);
                console.error("Run 'dadabot --help' for usage.");
                process.exit(1);
        }
    } catch (err) {
        console.error(`Fatal: ${(err as Error).message}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});
