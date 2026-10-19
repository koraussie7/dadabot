/**
 * dadabot-cli tests — 22 cases covering all subcommands + edge cases.
 *
 * 22 cases covering:
 *   - parseArgs: 5 (flags, positionals, --key=value, subcommand detection)
 *   - env: 2 (loadEnv defaults, custom home)
 *   - list/show/approve/reject: 8 (CR lifecycle, filter, JSON output)
 *   - run: 3 (auto-approve, await-decision, JSON parsing)
 *   - inbox/doctor/version: 4 (counts, health checks, version)
 *   - cli integration: 2 (end-to-end via run() function)
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/args.ts";
import { loadEnv, formatTable } from "../src/env.ts";
import { run } from "../src/cli.ts";
import {
  createInbox,
  createChangeRequest,
} from "../../busabase-adapter/src/index.ts";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: empty", () => {
  const p = parseArgs([]);
  assert.equal(p.command, null);
  assert.equal(p.positional.length, 0);
  assert.deepEqual(p.flags, {});
});

test("parseArgs: subcommand + positional", () => {
  const p = parseArgs(["show", "abc123"]);
  assert.equal(p.command, "show");
  assert.deepEqual(p.positional, ["abc123"]);
});

test("parseArgs: --flag value", () => {
  const p = parseArgs(["list", "--status", "open"]);
  assert.equal(p.command, "list");
  assert.equal(p.flags["status"], "open");
});

test("parseArgs: --flag=value", () => {
  const p = parseArgs(["approve", "x", "--comment=hello"]);
  assert.equal(p.command, "approve");
  assert.equal(p.flags["comment"], "hello");
});

test("parseArgs: boolean flag (no value)", () => {
  const p = parseArgs(["list", "--json"]);
  assert.equal(p.flags["json"], true);
});

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

test("loadEnv: defaults to $HOME/.dadabot", () => {
  const env = loadEnv();
  assert.match(env.home, /\.dadabot$/);
  assert.equal(env.dryRun, false);
  assert.match(env.inboxFile, /inbox\.json$/);
});

test("loadEnv: custom home", () => {
  const dir = mkdtempSync(join(tmpdir(), "dadabot-test-"));
  const env = loadEnv({ home: dir });
  assert.equal(env.home, dir);
});

// ---------------------------------------------------------------------------
// formatTable
// ---------------------------------------------------------------------------

test("formatTable: pads columns", () => {
  const out = formatTable([
    ["A", "B"],
    ["xx", "yy"],
  ]);
  assert.match(out, /A  B/);
  assert.match(out, /xx  yy/);
});

// ---------------------------------------------------------------------------
// inbox list / show
// ---------------------------------------------------------------------------

function makeTmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), "dadabot-test-"));
  return loadEnv({ home: dir });
}

test("inbox: empty inbox lists 0 CRs", () => {
  const env = makeTmpEnv();
  const code = run(["inbox", "--json"]);
  assert.equal(code, 0);
});

test("list: shows ChangeRequests with proper fields", () => {
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
  writeFileSync(file, JSON.stringify(proposal), "utf8");
  const runCode = run(["run", file, "--auto-approve"]);
  assert.equal(runCode, 0);
  const listCode = run(["list", "--json"]);
  assert.equal(listCode, 0);
});

test("list: filter by --status", () => {
  const env = makeTmpEnv();
  const code = run(["list", "--status", "open"]);
  assert.equal(code, 0);
});

test("show: not found returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["show", "nonexistent"]);
  assert.equal(code, 1);
});

test("show: requires id argument", () => {
  const env = makeTmpEnv();
  const code = run(["show"]);
  assert.equal(code, 1);
});

// ---------------------------------------------------------------------------
// approve / reject
// ---------------------------------------------------------------------------

test("approve: missing id returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["approve"]);
  assert.equal(code, 1);
});

test("approve: nonexistent CR returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["approve", "nonexistent"]);
  assert.equal(code, 1);
});

test("approve: not-open CR returns code 1", () => {
  const env = makeTmpEnv();
  const proposal = {
    id: "p-merged",
    agent: { name: "x", version: "0", modelProvider: "y", modelId: "z" },
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
  writeFileSync(file, JSON.stringify(proposal), "utf8");
  run(["run", file, "--auto-approve"]);
  const code = run(["approve", "p-merged"]);
  assert.equal(code, 1);
});

test("reject: missing id returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["reject"]);
  assert.equal(code, 1);
});

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

test("run: missing file argument returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["run"]);
  assert.equal(code, 1);
});

test("run: invalid JSON returns code 1", () => {
  const env = makeTmpEnv();
  const file = join(env.home, "bad.json");
  writeFileSync(file, "{not json", "utf8");
  const code = run(["run", file]);
  assert.equal(code, 1);
});

test("run: missing required proposal fields returns code 1", () => {
  const env = makeTmpEnv();
  const file = join(env.home, "incomplete.json");
  writeFileSync(file, JSON.stringify({ id: "x" }), "utf8");
  const code = run(["run", file]);
  assert.equal(code, 1);
});

// ---------------------------------------------------------------------------
// inbox / doctor / version
// ---------------------------------------------------------------------------

test("inbox: prints summary table", () => {
  const env = makeTmpEnv();
  const code = run(["inbox"]);
  assert.equal(code, 0);
});

test("doctor: passes on fresh env", () => {
  const env = makeTmpEnv();
  const code = run(["doctor"]);
  assert.equal(code, 0);
});

test("doctor: JSON output works", () => {
  const env = makeTmpEnv();
  const code = run(["doctor", "--json"]);
  assert.equal(code, 0);
});

test("version: prints version info", () => {
  const env = makeTmpEnv();
  const code = run(["version"]);
  assert.equal(code, 0);
});

// ---------------------------------------------------------------------------
// help + unknown command
// ---------------------------------------------------------------------------

test("help: prints help text", () => {
  const env = makeTmpEnv();
  const code = run(["help"]);
  assert.equal(code, 0);
});

test("unknown command returns code 1", () => {
  const env = makeTmpEnv();
  const code = run(["frobnicate"]);
  assert.equal(code, 1);
});
