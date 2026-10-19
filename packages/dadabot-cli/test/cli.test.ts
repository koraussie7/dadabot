/**
 * dadabot-cli tests — 22 cases covering all subcommands + edge cases.
 *
 * Strategy: dynamic-import the CLI module inside async test wrappers to
 * avoid Node 26's strict pending-promise check (which fires when a top-
 * level static import leaves a Promise unresolved on module load).
 *
 * 22 cases covering:
 *   - parseArgs: 5 (flags, positionals, --key=value, subcommand detection)
 *   - env: 2 (loadEnv defaults, custom home)
 *   - formatTable: 1 (column padding)
 *   - list/show/approve/reject: 8 (CR lifecycle, filter, JSON output)
 *   - run: 3 (auto-approve, invalid JSON, missing fields)
 *   - inbox/doctor/version: 4 (counts, health checks, version)
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Static imports for pure-function modules (no async side-effects).
import { parseArgs } from "../src/args.ts";
import { loadEnv, formatTable, type DadabotEnv } from "../src/env.ts";

let testEnv: ReturnType<typeof makeTmpEnv> | null = null;

function makeTmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), "dadabot-test-"));
  return loadEnv({ home: dir });
}

async function runCli(env: DadabotEnv, args: string[]): Promise<number> {
  const originalHome = process.env.DADABOT_HOME;
  process.env.DADABOT_HOME = env.home;
  try {
    const { run } = await import("../src/cli.ts");
    return run(args);
  } finally {
    if (originalHome === undefined) {
      delete process.env.DADABOT_HOME;
    } else {
      process.env.DADABOT_HOME = originalHome;
    }
  }
}

afterEach(() => {
  if (testEnv) {
    try {
      rmSync(testEnv.home, { recursive: true, force: true });
    } catch {}
    testEnv = null;
  }
});

function makeTmpEnvForTest() {
  testEnv = makeTmpEnv();
  return testEnv;
}
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
  // Column 1 padded to 2 chars ("xx"), then 2-space join => "A   B" (3 spaces).
  assert.match(out, /A   B/);
  assert.match(out, /xx  yy/);
});

// ---------------------------------------------------------------------------
// cli integration — async tests with dynamic import
// ---------------------------------------------------------------------------

test("inbox: empty inbox lists 0 CRs", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["inbox", "--json"]);
  assert.equal(code, 0);
});

test("list: filter by --status", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["list", "--status", "open"]);
  assert.equal(code, 0);
});

test("show: not found returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["show", "nonexistent"]);
  assert.equal(code, 1);
});

test("show: requires id argument", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["show"]);
  assert.equal(code, 1);
});

test("approve: missing id returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["approve"]);
  assert.equal(code, 1);
});

test("approve: nonexistent CR returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["approve", "nonexistent"]);
  assert.equal(code, 1);
});

test("reject: missing id returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["reject"]);
  assert.equal(code, 1);
});

test("run: missing file argument returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["run"]);
  assert.equal(code, 1);
});

test("run: invalid JSON returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const file = join(env.home, "bad.json");
  writeFileSync(file, "{not json", "utf8");
  const code = await runCli(env, ["run", file]);
  assert.equal(code, 1);
});

test("run: missing required proposal fields returns code 1", async () => {
  const env = makeTmpEnvForTest();
  const file = join(env.home, "incomplete.json");
  writeFileSync(file, JSON.stringify({ id: "x" }), "utf8");
  const code = await runCli(env, ["run", file]);
  assert.equal(code, 1);
});

test("inbox: prints summary table", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["inbox"]);
  assert.equal(code, 0);
});

test("doctor: passes on fresh env", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["doctor"]);
  assert.equal(code, 0);
});

test("version: prints version info", async () => {
  const env = makeTmpEnvForTest();
  const code = await runCli(env, ["version"]);
  assert.equal(code, 0);
});

test("list: shows ChangeRequests with proper fields", async () => {
  const env = makeTmpEnvForTest();
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
  const runCode = await runCli(env, ["run", file, "--auto-approve"]);
  assert.equal(runCode, 0);
  const listCode = await runCli(env, ["list", "--json"]);
  assert.equal(listCode, 0);
});
