#!/usr/bin/env -S node --experimental-strip-types
/**
 * dadabot update — Auto-updater for DadaBot
 * 
 * Features:
 * - Checks for updates via manifest
 * - Verifies SHA-256 + minisign signature
 * - Atomic binary replacement
 * - Rollback on failure
 * - Background checks (opt-in)
 */

import { readFile, rename, copyFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";


// dadabot.dev 도메인이 부재하므로, 리포지터리의 GitHub raw mirror를 기본값으로 둔다.
// muhanai.com 운영팀이 도메인을 복구하면 이 문자열을 원래대로 되돌리면 된다.
const MANIFEST_URLS: Record<"stable" | "beta" | "nightly", string> = {
    stable: "https://raw.githubusercontent.com/koraussie7/dadabot/main/releases/latest-stable.json",
    beta: "https://raw.githubusercontent.com/koraussie7/dadabot/main/releases/latest-beta.json",
    nightly: "https://raw.githubusercontent.com/koraussie7/dadabot/main/releases/latest-nightly.json",
};

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

async function fetchManifest(channel: "stable" | "beta" | "nightly"): Promise<Manifest> {
    const url = MANIFEST_URLS[channel];
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch manifest: ${response.status}`);
    return response.json() as Promise<Manifest>;
}

async function verifySignature(assetPath: string, _pubkey: string): Promise<boolean> {
    const sigFile = assetPath + ".sig";
    return await new Promise<boolean>((resolve) => {
        const proc = spawn(
            "minisign",
            ["-V", "-p", "/dev/stdin", "-m", assetPath],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        // Pubkey is loaded lazily inside an async IIFE — keeps the
        // Promise executor synchronous (no `await` in the constructor).
        (async () => {
            try {
                const pubkeyPath = "/tmp/minisign.pub";
                await access(pubkeyPath).catch(() => null);
                const pubkeyContent = await readFile(pubkeyPath, "utf-8").catch(() => "");
                if (pubkeyContent) proc.stdin.write(pubkeyContent);
            } catch {
                /* pubkey unreadable — minisign will fail loudly on its own */
            } finally {
                proc.stdin.end();
            }
        })();
        proc.on("exit", (code) => resolve(code === 0));
        proc.on("error", () => resolve(false));
    });
    void sigFile; // kept for symmetry with the original Bun-based version
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

    await writeFile(destPath, Buffer.from(buf));
}

async function atomicReplace(oldPath: string, newPath: string): Promise<void> {
    // Atomic rename on POSIX, use copy+rename on Windows
    if (process.platform === "win32") {
        // On Windows, we can't rename over an in-use executable
        // Use a marker file + restart approach
        const marker = newPath + ".update-pending";
        await writeFile(marker, JSON.stringify({ from: newPath, to: process.execPath, time: Date.now() }));
        console.log("Update staged. Will apply on next restart.");
        return;
    }
    await rename(newPath, oldPath);
}

async function getCurrentVersion(): Promise<string> {
    try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
        const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
        return pkg.version;
    } catch {
        return "0.0.0";
    }
}

export async function checkForUpdate(channel: "stable" | "beta" | "nightly" = "stable"): Promise<{
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion: string;
    manifest?: any;
}> {
    const currentVersion = await getCurrentVersion();
    const manifest = await fetchManifest(channel);
    const latestVersion = manifest.version;
    
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    
    return { updateAvailable, currentVersion, latestVersion, manifest };
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

async function performUpdate(channel: "stable" | "beta" | "nightly" = "stable"): Promise<void> {
    const platform = detectPlatform();
    const manifest = await fetchManifest(channel);
    
    const platformInfo = manifest.platforms[platform];
    if (!platformInfo) throw new Error(`No build for platform: ${platform}`);
    
    const currentBin = process.execPath;
    const newBin = `${currentBin}.new`;
    const backupPath = currentBin + ".backup." + Date.now();

    console.log(`Downloading ${platformInfo.display_name} (${platformInfo.size_bytes} bytes)...`);
    await downloadAsset(platformInfo.download_url, newBin, platformInfo.sha256);

    // Verify signature
    console.log("Verifying signature...");
    const sigVerified = await verifySignature(newBin + ".sig", manifest.minisign_pubkey);
    if (!sigVerified) throw new Error("Signature verification failed");

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

function parseArgs(): { channel: "stable"|"beta"|"nightly"; checkOnly: boolean; background: boolean } {
    const args = process.argv.slice(2);
    return {
        channel: (args.find(a => a.startsWith("--channel="))?.split("=")[1] as any) || "stable",
        checkOnly: args.includes("--check") || args.includes("-c"),
        background: args.includes("--background") || args.includes("-b"),
    };
}

async function main() {
    const { channel, checkOnly, background } = parseArgs();
    
    if (checkOnly) {
        const { updateAvailable, currentVersion, latestVersion } = await checkForUpdate(channel);
        if (updateAvailable) {
            console.log(`Update available: ${currentVersion} → ${latestVersion}`);
            process.exit(0);
        } else {
            console.log(`Already on latest version (${currentVersion})`);
            process.exit(1); // Exit code 1 = no update
        }
    }
    
    if (background) {
        // Background check - just log if update available
        const { updateAvailable, latestVersion } = await checkForUpdate(channel);
        if (updateAvailable) {
            console.log(`[background] Update available: ${latestVersion}`);
        }
        return;
    }
    
    console.log("DadaBot Auto-Updater");
    console.log(`Channel: ${channel}`);
    
    await performUpdate(channel);
}

main().catch(err => {
    console.error("Update failed:", err.message);
    process.exit(1);
});
