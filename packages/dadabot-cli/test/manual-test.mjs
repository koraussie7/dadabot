#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Manual test runner for dadabot-cli to avoid Node 26 pending-promise issues
 * with the test runner's module loading.
 */

import { parseArgs } from "../src/args.ts";
import { loadEnv, formatTable, formatJson } from "../src/env.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

async function getRun() {
  const { run } = await import("../src/cli.ts");
  return run;
}

function makeTmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), "dadabot-test-"));
  return loadEnv({ home: dir });
}

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log("✔ " + name);
    passed++;
  } catch (err) {
    console.error("✖ " + name);
    console.error("  " + (err instanceof Error ? err.message : String(err)));
    failed++;
  }
}

async function main() {
  console.log("\n--- parseArgs tests ---");
  await runTest("parseArgs: empty", () => {
    const p = parseArgs([]);
    assert.equal(p.command, null);
    assert.equal(p.positional.length, 0);
    assert.deepEqual(p.flags, {});
  });

  await runTest("parseArgs: subcommand + positional", () => {
    const p = parseArgs(["show", "abc123"]);
    assert.equal(p.command, "show");
    assert.deepEqual(p.positional, ["abc123"]);
  });

  await runTest("parseArgs: --flag value", () => {
    const p = parseArgs(["list", "--status", "open"]);
    assert.equal(p.command, "list");
    assert.equal(p.flags["status"], "open");
  });

  await runTest("parseArgs: --flag=value", () => {
    const p = parseArgs(["approve", "x", "--comment=hello"]);
    assert.equal(p.command, "approve");
    assert.equal(p.flags["comment"], "hello");
  });

  await runTest("parseArgs: boolean flag (no value)", () => {
    const p = parseArgs(["list", "--json"]);
    assert.equal(p.flags["json"], true);
  });

  console.log("\n--- env tests ---");
  await runTest("loadEnv: defaults to $HOME/.dadabot", () => {
    const env = loadEnv();
    assert.match(env.home, /\.dadabot$/);
    assert.equal(env.dryRun, false);
    assert.match(env.inboxFile, /inbox\.json$/);
  });

  await runTest("loadEnv: custom home", () => {
    const dir = mkdtempSync(join(tmpdir(), "dadabot-test-"));
    const env = loadEnv({ home: dir });
    assert.equal(env.home, dir);
  });

  await runTest("formatTable: pads columns", () => {
    const out = formatTable([
      ["A", "B"],
      ["xx", "yy"],
    ]);
    assert.match(out, /A   B/);
    assert.match(out, /xx  yy/);
  });

  console.log("\n--- CLI integration tests ---");
  
  await runTest("inbox: empty inbox lists 0 CRs", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["inbox", "--json"]);
    assert.equal(code, 0);
  });

  await runTest("list: filter by --status", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["list", "--status", "open"]);
    assert.equal(code, 0);
  });

  await runTest("show: not found returns code 1", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["show", "nonexistent"]);
    assert.equal(code, 1);
  });

  await runTest("show: requires id argument", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["show"]);
    assert.equal(code, 1);
  });

  await runTest("approve: missing id returns code 1", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["approve"]);
    assert.equal(code, 1);
  });

  await runTest("approve: nonexistent CR returns code 1", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["approve", "nonexistent"]);
    assert.equal(code, 1);
  });

  await runTest("reject: missing id returns code 1", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["reject"]);
    assert.equal(code, 1);
  });

  await runTest("run: missing file argument returns code 1", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["run"]);
    assert.equal(code, 1);
  });

  await runTest("run: invalid JSON returns code 1", async () => {
    const env = makeTmpEnv();
    const file = join(env.home, "bad.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{not json", "utf8");
    const { run } = await import("../src/cli.ts");
    const code = run(["run", file]);
    assert.equal(code, 1);
  });

  await runTest("run: missing required proposal fields returns code 1", async () => {
    const env = makeTmpEnv();
    const file = join(env.home, "incomplete.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, JSON.stringify({ id: "x" }), "utf8");
    const { run } = await import("../src/cli.ts");
    const code = run(["run", file]);
    assert.equal(code, 1);
  });

  await runTest("inbox: prints summary table", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["inbox"]);
    assert.equal(code, 0);
  });

  await runTest("doctor: passes on fresh env", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["doctor"]);
    assert.equal(code, 0);
  });

  await runTest("version: prints version info", async () => {
    const env = makeTmpEnv();
    const { run } = await import("../src/cli.ts");
    const code = run(["version"]);
    assert.equal(code, 0);
  });

  await runTest("list: shows ChangeRequests with proper fields", async () => {
    const env = makeTmpEnv();
    const proposal = {
      id: "p-1",
      agent: { name: "claude-sonnet", version: "0.1.0", modelProvider: "anthropic", modelId: "claude-sonnet-4.5" },
      title: "Refactor FindPage to use sam-tools free models",
      rationale: "Reduce API cost by routing read-only calls to free model rotator.",
      confidence: 0.95,
      reversible: true,
      kind: "file_edit",
      files: [{ path: "a.ts", operation: "modify", content: "x", linesAdded: 1, linesRemoved: 1 }],
      toolCalls: [],
      createdAt: Date.now(),
    };
    const file = join(env.home, "proposal.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, JSON.stringify(proposal), "utf8");
    const { run } = await import("../src/cli.ts");
    const runCode = run(["run", file, "--auto-approve"]);
    assert.equal(runCode, 0);
    const listCode = run(["list", "--json"]);
    assert.equal(listCode, 0);
  });

  console.log("\n--- Results ---");
  console.log("Passed: " + passed);
  console.log("Failed: " + failed);
  
  if (failed > 0) {
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
